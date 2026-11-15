# Vendored browser libraries (Worker 2, SPEC 9.3)

Committed as-is so there is no bundler and no package.json change. Total stays under 1.5 MB.

| File | Library | Version | License | Source |
|---|---|---|---|---|
| `marked.esm.js` | marked (Markdown lexer) | 18.2.0 | MIT | https://www.npmjs.com/package/marked (`lib/marked.esm.js`) |
| `temml-mhchem.js` | Temml (TeX to MathML) + its mhchem extension (`\ce`, `\pu`) | 0.14.0 | MIT (mhchem parts: Apache-2.0, MathJax Consortium and Martin Hensel) | https://www.npmjs.com/package/temml (`dist/temml.min.js` + `contrib/mhchem/mhchem.min.js`, joined, with `export default temml;` added at the end so it loads as an ES module) |
| `highlight/core.min.js`, `highlight/languages/*.min.js` | highlight.js core + python, javascript, c, cpp, java, sql, bash, json | 11.12.0 | BSD-3-Clause | https://www.npmjs.com/package/@highlightjs/cdn-assets (`es/`) |

DOMPurify is not vendored: the renderer never parses an HTML string (it builds every element from marked's tokens with DOM calls, and rebuilds highlight.js spans the same way), so there is nothing for it to sanitize.
