// Only these small grammars are included, in a chunk loaded on the first code block.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
for (const [name, grammar] of Object.entries({ bash, javascript, typescript, python, json, css, xml, sql })) hljs.registerLanguage(name, grammar);
export function highlight(source: string, language: string): string | null {
  return hljs.getLanguage(language) ? hljs.highlight(source, { language, ignoreIllegals: true }).value : null;
}
