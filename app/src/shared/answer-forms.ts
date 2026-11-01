type Day = { day: string; condition: string; high: number; low: number };
type Card = { title: string; line?: string; owner?: string };
type Series = { name: string; values: number[] };
export type AnswerForm =
  | { kind: "forecast"; place: string; units: string; days: Day[] }
  | { kind: "board"; columns: { title: string; cards: Card[] }[] }
  | { kind: "chart"; type: "bar" | "line"; title: string; units: string; labels: string[]; series: Series[] };

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []): boolean => required.every(k => Object.prototype.hasOwnProperty.call(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const word = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 160;
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12;
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length > 0 && v.length <= max;

/** Strict, bounded data only. Invalid and provisional content stays in the ordinary code path. */
export function parseAnswerForm(kind: string, source: string): AnswerForm | null {
  if (!["forecast", "board", "chart"].includes(kind) || source.length > 24000) return null;
  try {
    const v: unknown = JSON.parse(source);
    if (!object(v)) return null;
    if (kind === "forecast" && keys(v, ["place", "units", "days"]) && word(v.place) && word(v.units) && list(v.days, 7) && v.days.every(d => object(d) && keys(d, ["day", "condition", "high", "low"]) && word(d.day) && word(d.condition) && number(d.high) && number(d.low) && d.high >= d.low && Math.abs(d.high) <= 1000 && Math.abs(d.low) <= 1000)) return { kind, ...v } as AnswerForm;
    if (kind === "board" && keys(v, ["columns"]) && list(v.columns, 5) && v.columns.every(c => object(c) && keys(c, ["title", "cards"]) && word(c.title) && Array.isArray(c.cards) && c.cards.length <= 20 && c.cards.every(card => object(card) && keys(card, ["title"], ["line", "owner"]) && word(card.title) && (card.line === undefined || word(card.line)) && (card.owner === undefined || word(card.owner))))) return { kind, ...v } as AnswerForm;
    if (kind === "chart" && keys(v, ["type", "title", "units", "labels", "series"]) && (v.type === "bar" || v.type === "line") && word(v.title) && word(v.units) && list(v.labels, 24) && v.labels.every(word) && list(v.series, 2) && v.series.every(s => object(s) && keys(s, ["name", "values"]) && word(s.name) && Array.isArray(s.values) && s.values.length === (v.labels as unknown[]).length && s.values.every(number))) return { kind, ...v } as AnswerForm;
  } catch { /* A streaming JSON fragment remains readable code. */ }
  return null;
}

export function answerFormText(form: AnswerForm): string {
  if (form.kind === "forecast") return [form.place, ...form.days.map(d => `${d.day}: ${d.condition}, ${d.high} / ${d.low} ${form.units}`)].join("\n");
  if (form.kind === "board") return form.columns.map(c => [c.title, ...c.cards.map(card => `- ${card.title}${card.line ? ` — ${card.line}` : ""}${card.owner ? ` (${card.owner})` : ""}`)].join("\n")).join("\n\n");
  return [form.title, ...form.labels.map((label, i) => `${label}: ${form.series.map(s => `${s.name} ${s.values[i]} ${form.units}`).join("; ")}`)].join("\n");
}

/** Keep fences inside ordinary code literal; only closed, valid forms become words. */
export function formsPlainText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(lines[i]);
    if (!fence) { out.push(lines[i]); continue; }
    const start = i, source: string[] = [], end = new RegExp(`^[ \t]*${fence[1][0]}{${fence[1].length},}[ \t]*$`);
    while (++i < lines.length && !end.test(lines[i])) source.push(lines[i]);
    const form = i < lines.length ? parseAnswerForm(fence[2].toLowerCase(), source.join("\n")) : null;
    out.push(form ? answerFormText(form) : lines.slice(start, Math.min(i + 1, lines.length)).join("\n"));
  }
  return out.join("\n");
}
