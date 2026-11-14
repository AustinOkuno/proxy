# LLM providers (Worker 2)

`index.js` exports `createProvider(name, { env })`; `gemini.js` is the Gemini adapter.
See SPEC.md, "Provider adapter".

- `prompt.js`: provider-neutral helpers (system instruction per answer style,
  session messages to Gemini `contents`, JSON reply parsing, style enforcement).
- `gemini.js`: calls `@google/genai` with a JSON response schema
  `{ answer, explanation }` and maps failures to readable messages.

To add a provider: write `<name>.js` exporting a factory that returns
`{ generate({ messages, answerStyle }) }`, and register it in `index.js`.
