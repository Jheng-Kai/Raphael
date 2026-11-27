// KaTeX ships no types; this is the one call the app makes (math-html.ts).
declare module "katex" {
  const katex: { renderToString(tex: string, options?: Record<string, unknown>): string };
  export default katex;
}
