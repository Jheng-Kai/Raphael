import { readFileSync } from "node:fs";

// Run against a typing trace after Edge closes. Keep sample-based JS attribution separate from exact renderer events.
const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/look/typing-trace.mjs <typing.trace.json>");
const { traceEvents } = JSON.parse(readFileSync(path, "utf8"));
const starts = traceEvents.filter(event => /^typing-key-\d+-start$/.test(event.name));
if (!starts.length) throw new Error("No typing marks in this trace");
const main = traceEvents.filter(({ pid, tid }) => pid === starts[0].pid && tid === starts[0].tid);
const ends = new Map(main.filter(event => /^typing-key-\d+-end$/.test(event.name)).map(event => [event.name, event.ts]));
const keys = starts.map(mark => ({
  key: Number(mark.name.split("-")[2]), start: mark.ts, end: ends.get(mark.name.replace("-start", "-end")),
  self: new Map(), inclusive: new Map(),
}));
if (keys.some(key => !key.end)) throw new Error("Incomplete typing marks");
const profile = main.find(event => event.name === "Profile");
const nodes = new Map();
const round = microseconds => +(microseconds / 1000).toFixed(2);
const add = (totals, name, duration) => totals.set(name, (totals.get(name) ?? 0) + duration);
if (profile) {
  const chunks = traceEvents.filter(event => event.name === "ProfileChunk" && event.pid === profile.pid && event.id === profile.id).sort((a, b) => a.ts - b.ts);
  for (const chunk of chunks) for (const node of chunk.args?.data?.cpuProfile?.nodes ?? []) nodes.set(node.id, node);
  let previous = profile.args.data.startTime, nextKey = 0;
  for (const chunk of chunks) {
    const { timeDeltas = [], cpuProfile } = chunk.args.data;
    for (const [index, id] of (cpuProfile?.samples ?? []).entries()) {
      const at = previous + timeDeltas[index];
      while (keys[nextKey]?.end <= previous) ++nextKey;
      const key = keys[nextKey];
      const duration = key ? Math.min(at, key.end) - Math.max(previous, key.start) : 0;
      previous = at;
      if (duration <= 0) continue;
      let node = nodes.get(id);
      const names = new Set();
      while (node) {
        const { url, functionName, lineNumber } = node.callFrame;
        const name = url?.includes("/src/") ? `${functionName || "(anonymous)"} ${new URL(url).pathname}:${lineNumber + 1}` : null;
        if (name) {
          if (node.id === id) add(key.self, name, duration);
          names.add(name);
        }
        node = nodes.get(node.parent);
      }
      for (const name of names) add(key.inclusive, name, duration);
    }
  }
}
const frame = call => ({ name: call.functionName || "(anonymous)", source: call.url, line: call.lineNumber });
const evidence = keys.map(key => {
  const events = main.filter(event => key.start <= event.ts && event.ts < key.end);
  return {
    key: key.key, markToFrameMs: round(key.end - key.start),
    callbacks: events.filter(event => event.name === "FunctionCall" && event.dur >= 1000)
      .map(event => ({ ...frame(event.args.data), wallMs: round(event.dur) })),
    sampledFunctions: [...key.inclusive].filter(([, duration]) => duration >= 1000).sort((a, b) => b[1] - a[1])
      .map(([name, duration]) => ({ name, inclusiveMs: round(duration), selfMs: round(key.self.get(name) ?? 0) })),
    layout: events.filter(event => event.name === "Layout").map(event => ({
      ms: round(event.dur), dirtyObjects: event.args.beginData.dirtyObjects,
      roots: event.args.endData?.layoutRoots?.map(root => root.nodeName), stack: event.args.beginData.stackTrace?.map(frame),
    })),
    style: events.filter(event => event.name === "UpdateLayoutTree").map(event => ({
      ms: round(event.dur), elements: event.args.elementCount, stack: event.args.beginData.stackTrace?.map(frame),
    })),
  };
});
console.log(JSON.stringify({ trace: path, evidence }, null, 2));
