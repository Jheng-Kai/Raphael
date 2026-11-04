// Present installed skill provenance without exposing transport or cache internals.
export function skillSourceLabel(source: string, plugin?: string): string {
  const path = source.replace(/^local:/, "").replace(/\\/g, "/");
  const cached = path.match(/\/\.(?:claude|codex)\/plugins\/cache\/[^/]+\/([^/]+)\/([^/]+)(?:\/|$)/i);
  if (cached) return `${plugin || cached[1]} · ${cached[2]}`;
  return path.replace(/^.*(?=\/\.(?:claude|codex|agents)\/(?:skills|plugins)(?:\/|$))/i, "~");
}
