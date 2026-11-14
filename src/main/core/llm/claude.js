'use strict';

/**
 * Claude (Pro) adapter. Runs the official Claude Code CLI on this machine in
 * print mode (`claude -p`), logged in with the user's own Claude Pro/Max
 * account, so no API key is needed and replies count against the user's
 * normal Claude usage. Personal use only: this only ever starts the `claude`
 * command; it never reads the login token or calls the API itself.
 *
 * Each request starts one short-lived `claude` process:
 *   - in a new, empty temp folder, with every tool turned off (`--tools ""`),
 *     so it can only answer and never read or change files or run commands;
 *   - with `--safe-mode`, so the user's own CLAUDE.md, hooks, plugins and MCP
 *     servers don't load (faster startup, nothing personal in the prompt);
 *   - with the screenshots and the conversation sent on stdin as one
 *     stream-json user message (images as base64 blocks, no temp image files);
 *   - with `--json-schema`, so the reply comes back as { answer, explanation }.
 * Follow-ups resend the earlier turns (same as the Gemini adapter), so no CLI
 * session has to be kept or resumed.
 *
 * Implements SPEC.md 4.2: generate({ messages, answerStyle, signal }).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { CLAUDE_MODELS } = require('../../../shared/contracts');
const { systemInstruction, parseReply, applyStyle, assistantTurnText } = require('./prompt');
const { createImageShrinker, electronNativeImage } = require('./images');

const LABEL = 'Claude (Pro)';
const DEFAULT_MODEL = CLAUDE_MODELS.HAIKU;
// One answer normally takes a few seconds; give up well before "minutes".
const DEADLINE_MS = 120_000;
// After Stop, give the CLI this long to exit on SIGTERM before SIGKILL.
const KILL_GRACE_MS = 2_000;
// Screenshots sent per request, newest first. Older ones are replaced by a note.
const MAX_IMAGES = 8;
const STDERR_KEEP = 4_000;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    explanation: { type: 'string' },
  },
  required: ['answer', 'explanation'],
  additionalProperties: false,
};

const INSTALL_STEPS = 'Install it in a terminal with: curl -fsSL https://claude.ai/install.sh | bash   '
  + 'then run: claude auth login   and sign in with your Claude Pro account. Then press Retry. '
  + 'If it is installed somewhere unusual, set CLAUDE_PATH in .env to the full path of the claude command and restart Proxy.';
const NOT_INSTALLED_MESSAGE = `Claude Code isn't installed, or Proxy can't find the "claude" command. ${INSTALL_STEPS}`;
const NOT_LOGGED_IN_MESSAGE = 'Claude Code is installed but not logged in. Open a terminal, run: claude auth login   '
  + 'and sign in with your Claude Pro account (choose the Claude subscription, not the Console). Then press Retry.';
const STOPPED_MESSAGE = 'Stopped.';

function stoppedError() {
  const err = new Error(STOPPED_MESSAGE);
  err.name = 'AbortError';
  err.stopped = true;
  return err;
}

function deadlineMessage(ms) {
  const secs = Math.max(1, Math.round(ms / 1000));
  const when = secs < 120 ? `${secs} seconds` : `${Math.round(secs / 6) / 10} minutes`;
  return `Claude didn't answer within ${when}, so the request was stopped. Press Retry, or pick a faster model in Settings.`;
}

// ---------------------------------------------------------------------------
// Finding the CLI
// ---------------------------------------------------------------------------

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where to look for `claude`. Proxy is often started from the Mint menu, whose
 * PATH lacks ~/.local/bin (the native installer's folder) and nvm's folders,
 * so look there too.
 */
function candidatePaths(env = {}, { readdir = (d) => fs.readdirSync(d) } = {}) {
  const home = env.HOME || os.homedir();
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  dirs.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
  );
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    for (const v of readdir(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin'));
  } catch { /* no nvm */ }
  return [...new Set(dirs)].map((d) => path.join(d, 'claude'));
}

/** Full path of the claude command, or null. CLAUDE_PATH in .env wins. */
function findClaude(env = {}, { isExecutable = isExecutableFile, readdir } = {}) {
  const explicit = String(env.CLAUDE_PATH || '').trim();
  if (explicit) return isExecutable(explicit) ? explicit : null;
  for (const p of candidatePaths(env, { readdir })) {
    if (isExecutable(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const EXTRA_INSTRUCTION = [
  'You are running inside the Proxy desktop app with no tools: answer only from the conversation and screenshots.',
  'Return your reply through the structured output with the "answer" and "explanation" fields.',
].join('\n');

function claudeSystemPrompt(answerStyle) {
  return `${systemInstruction(answerStyle)}\n${EXTRA_INSTRUCTION}`;
}

const usable = (m) => m && (m.role === 'user'
  || (m.role === 'assistant' && !m.error && !m.stopped && (m.answer || m.explanation)));

const imagesOf = (m) => (m.role === 'user' && Array.isArray(m.images)
  ? m.images.filter((img) => img && typeof img.dataBase64 === 'string' && img.dataBase64)
  : []);

/**
 * Turn the session into the content blocks of ONE user message: earlier turns
 * as a labelled transcript, then the newest user message. Failed and stopped
 * replies are skipped. Only the newest MAX_IMAGES screenshots are attached.
 * @param {import('../../../shared/contracts').Message[]} messages
 * @param {(img: object) => object} [shrink]
 */
function buildUserContent(messages, shrink = (i) => i) {
  const msgs = (messages || []).filter(usable);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) return [];

  // The newest turn is the trailing run of user messages.
  let split = msgs.length;
  while (split > 0 && msgs[split - 1].role === 'user') split--;
  const earlier = msgs.slice(0, split);
  const newest = msgs.slice(split);

  // Pick which screenshots to attach, newest first.
  const keep = new Set();
  for (let i = msgs.length - 1; i >= 0 && keep.size < MAX_IMAGES; i--) {
    for (const img of imagesOf(msgs[i]).slice().reverse()) {
      if (keep.size < MAX_IMAGES) keep.add(img);
    }
  }

  const blocks = [];
  const text = (t) => blocks.push({ type: 'text', text: t });
  const userTurn = (m, emptyNote) => {
    for (const img of imagesOf(m)) {
      if (!keep.has(img)) { text('[an earlier screenshot, not included]'); continue; }
      const s = shrink(img) || img;
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: s.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png', data: s.dataBase64 },
      });
    }
    if (m.text && m.text.trim()) text(m.text);
    else if (emptyNote) text(emptyNote);
  };

  if (earlier.length) {
    text('Conversation so far, oldest first:');
    for (const m of earlier) {
      if (m.role === 'user') {
        text('User:');
        userTurn(m, '(screenshot only, no text)');
      } else {
        text(`You replied: ${assistantTurnText(m)}`);
      }
    }
    text("The user's new message:");
  }
  for (const m of newest) {
    userTurn(m, imagesOf(m).length ? '(No text, just the screenshot. Work out what the user most likely wants from it.)' : null);
  }
  return blocks;
}

function buildArgs({ model, answerStyle }) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose', // stream-json output requires it in print mode
    '--model', model,
    '--system-prompt', claudeSystemPrompt(answerStyle),
    '--json-schema', JSON.stringify(RESPONSE_SCHEMA),
    '--tools', '', // no tools: it can only answer
    '--safe-mode', // skip the user's CLAUDE.md, hooks, plugins, MCP servers
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence', // nothing written to ~/.claude/projects
  ];
}

/** Environment for the child: the user's, minus anything that would bill an API key or leak a secret. */
function childEnv(env, binPath) {
  const out = { ...env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete out[k];
  // npm/nvm installs are `#!/usr/bin/env node` scripts: make sure their node is on PATH.
  if (binPath) out.PATH = [path.dirname(binPath), out.PATH].filter(Boolean).join(path.delimiter);
  return out;
}

// ---------------------------------------------------------------------------
// Output parsing and errors
// ---------------------------------------------------------------------------

/** Turn CLI / API error text into a short, user-readable message. */
function friendlyError(raw) {
  const msg = String(raw || '').trim();
  if (/not logged in|\/login|log ?in again|invalid api key|authenticat|oauth|token (has )?expired|unauthori[sz]ed|\b401\b/i.test(msg)) {
    return NOT_LOGGED_IN_MESSAGE;
  }
  if (/usage limit|hit your limit|limit reached|out of (extra )?usage|rate.?limit|\b429\b/i.test(msg)) {
    return 'You have reached your Claude Pro usage limit for now. Wait until it resets (Claude shows the time at claude.ai), or switch to Gemini in Settings.';
  }
  if (/unknown option|unrecognized option|error: option/i.test(msg)) {
    return 'Your Claude Code is too old for Proxy. Update it in a terminal with: claude update   then press Retry.';
  }
  if (/issue with the selected model|model.*(not exist|not found|access)/i.test(msg)) {
    return 'Your Claude account can\'t use that model. Pick another Claude model in Settings and press Retry.';
  }
  if (/overloaded|\b5\d\d\b|internal server error/i.test(msg)) {
    return 'Claude is busy or having trouble right now. Press Retry in a moment.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|unable to connect|network/i.test(msg)) {
    return 'Could not reach Claude. Check your internet connection.';
  }
  return `Claude error: ${msg.slice(0, 300) || 'the claude command failed with no message.'}`;
}

/** Line-by-line stream-json reader: keeps the init model, last assistant model and the result. */
function createStreamParser() {
  let buf = '';
  const state = { initModel: null, model: null, result: null };
  function line(l) {
    if (!l.trim()) return;
    let ev;
    try { ev = JSON.parse(l); } catch { return; }
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') state.initModel = ev.model;
    else if (ev.type === 'assistant' && ev.message && typeof ev.message.model === 'string' && !ev.message.model.startsWith('<')) state.model = ev.message.model;
    else if (ev.type === 'result') state.result = ev;
  }
  return {
    state,
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        line(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    },
    end() {
      line(buf);
      buf = '';
      return state;
    },
  };
}

/** Result event -> { answer, explanation, model } or throws a readable Error. */
function replyFromResult(state, answerStyle, alias) {
  const r = state.result;
  if (r.is_error || (r.subtype && r.subtype !== 'success')) {
    const why = r.result || (Array.isArray(r.errors) && r.errors.join('; ')) || r.subtype || '';
    throw new Error(friendlyError(`${why}${r.api_error_status ? ` (${r.api_error_status})` : ''}`));
  }
  let reply;
  const so = r.structured_output;
  if (so && typeof so === 'object' && (typeof so.answer === 'string' || typeof so.explanation === 'string')) {
    reply = { answer: String(so.answer || '').trim(), explanation: String(so.explanation || '').trim() };
  } else {
    reply = parseReply(typeof r.result === 'string' ? r.result : '');
  }
  if (!reply.answer && !reply.explanation) throw new Error('Claude returned an empty answer. Press Retry.');
  const usage = r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage) : [];
  const model = state.model || state.initModel || usage[0] || alias;
  return { ...applyStyle(reply, answerStyle), model: `${LABEL} · ${model}` };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   settings?: { get(): { claudeModel?: string } },
 *   spawn?: typeof childProcess.spawn,
 *   find?: (env: object) => string|null,
 *   shrinkImage?: (img: object) => object,
 *   makeTempDir?: () => string,
 *   removeDir?: (dir: string) => void,
 *   deadlineMs?: number,
 *   killGraceMs?: number,
 *   logger?: Pick<Console,'warn'>,
 * }} opts
 */
function createClaudeProvider({
  env = {},
  settings = null,
  spawn = childProcess.spawn,
  find = findClaude,
  shrinkImage = createImageShrinker({ nativeImage: electronNativeImage() }),
  makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-claude-')),
  removeDir = (dir) => fs.rmSync(dir, { recursive: true, force: true }),
  deadlineMs = DEADLINE_MS,
  killGraceMs = KILL_GRACE_MS,
  logger = console,
} = {}) {
  const currentModel = () => {
    const m = settings && typeof settings.get === 'function' ? settings.get().claudeModel : null;
    return Object.values(CLAUDE_MODELS).includes(m) ? m : DEFAULT_MODEL;
  };

  /** Run one `claude -p` and resolve with the parsed stream state. */
  function run(bin, args, input, signal) {
    return new Promise((resolve, reject) => {
      let cwd;
      try { cwd = makeTempDir(); } catch (err) { reject(new Error(`Could not create a temp folder for Claude: ${err.message}`)); return; }

      let child;
      try {
        child = spawn(bin, args, { cwd, env: childEnv(env, bin), stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        try { removeDir(cwd); } catch { /* ignore */ }
        reject(err.code === 'ENOENT' ? new Error(NOT_INSTALLED_MESSAGE) : err);
        return;
      }

      const parser = createStreamParser();
      let stderr = '';
      let settled = false;
      let killTimer = null;
      let why = null; // 'stopped' | 'timeout'

      const kill = (reason) => {
        if (why || settled) return;
        why = reason;
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, killGraceMs);
        if (killTimer.unref) killTimer.unref();
        // Don't make the user wait for the process to exit.
        finish(reason === 'timeout' ? new Error(deadlineMessage(deadlineMs)) : stoppedError());
      };
      const onAbort = () => kill('stopped');
      const timer = setTimeout(() => kill('timeout'), deadlineMs);

      function finish(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve(value);
      }

      if (signal) {
        if (signal.aborted) { onAbort(); } else signal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => parser.push(d));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-STDERR_KEEP); });
      child.stdin.on('error', () => { /* the CLI exited early; the exit handler reports why */ });

      child.on('error', (err) => {
        if (killTimer) clearTimeout(killTimer);
        try { removeDir(cwd); } catch { /* ignore */ }
        finish(err && err.code === 'ENOENT' ? new Error(NOT_INSTALLED_MESSAGE) : new Error(friendlyError(err && err.message)));
      });
      child.on('close', (code) => {
        if (killTimer) clearTimeout(killTimer);
        try { removeDir(cwd); } catch { /* ignore */ }
        const state = parser.end();
        if (state.result) { finish(null, state); return; }
        const text = stderr.trim();
        if (text) logger.warn(`[core] claude exited with code ${code}: ${text.slice(-500)}`);
        finish(new Error(text ? friendlyError(text) : `The claude command exited (code ${code}) without an answer. Press Retry.`));
      });

      child.stdin.end(`${JSON.stringify(input)}\n`);
    });
  }

  return {
    name: 'claude-pro',
    get model() {
      return `${LABEL} · ${currentModel()}`;
    },
    /**
     * @param {{ messages: object[], answerStyle: string, signal?: AbortSignal }} req
     */
    async generate({ messages, answerStyle, signal } = {}) {
      if (signal && signal.aborted) throw stoppedError();
      const content = buildUserContent(messages || [], shrinkImage);
      if (!content.length) throw new Error('Nothing to send to Claude.');
      const bin = find(env);
      if (!bin) throw new Error(NOT_INSTALLED_MESSAGE);

      const model = currentModel();
      const input = { type: 'user', message: { role: 'user', content } };
      const state = await run(bin, buildArgs({ model, answerStyle }), input, signal);
      if (signal && signal.aborted) throw stoppedError();
      return replyFromResult(state, answerStyle, model);
    },
  };
}

module.exports = {
  createClaudeProvider,
  buildUserContent,
  buildArgs,
  childEnv,
  findClaude,
  candidatePaths,
  friendlyError,
  createStreamParser,
  replyFromResult,
  claudeSystemPrompt,
  RESPONSE_SCHEMA,
  NOT_INSTALLED_MESSAGE,
  NOT_LOGGED_IN_MESSAGE,
  STOPPED_MESSAGE,
  DEFAULT_MODEL,
  DEADLINE_MS,
  MAX_IMAGES,
  LABEL,
};
