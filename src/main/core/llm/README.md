# LLM providers (Worker 2)

`index.js` exports `createProvider(name, { env, settings })`. See SPEC.md, "Provider adapter".

- `prompt.js`: provider-neutral helpers (system instruction per answer style,
  session messages to Gemini `contents`, JSON reply parsing, style enforcement).
- `gemini.js`: calls `@google/genai` with a JSON response schema
  `{ answer, explanation }` and maps failures to readable messages.
- `claude.js`: "Claude (Pro)". Runs the local Claude Code CLI (`claude -p`,
  logged in with the user's Claude Pro account) once per request in an empty
  temp folder with all tools off and `--safe-mode`. The screenshots and the
  conversation go in on stdin as one stream-json user message; `--json-schema`
  returns `{ answer, explanation }`. Stop and the 2-minute deadline kill the
  process. The model comes from `settings.claudeModel` (haiku/sonnet/opus).
- `images.js`: shrinks big screenshots before they are sent (both providers).

To add a provider: write `<name>.js` exporting a factory that returns
`{ generate({ messages, answerStyle, signal }) }`, and register it in `index.js`.
