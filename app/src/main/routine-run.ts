import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import type { RoutineRun } from "./types";

type RunState = { running: boolean; reason: string; run?: RoutineRun };
const states = new Map<number, RunState>();
const listeners = new Set<() => void>();
export const routineRunState = (id: number): RunState => states.get(id) ?? { running: false, reason: "" };
export function watchRoutineRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const changed = (): void => { for (const listener of listeners) listener(); };
export function runStatusWords(status: string): string {
  return t(status === "done" ? "routine.succeeded" : ["running", "confirm", "queued", "waiting"].includes(status) ? "routine.running" : "routine.failed");
}

/** Manual work uses the production worker and keeps its pending state across editor closure. */
export async function testRoutine(id: number): Promise<void> {
  if (routineRunState(id).running) return;
  states.set(id, { running: true, reason: "" }); changed();
  try {
    const result = await api.routinesRun(id);
    if (!result.run_id) {
      states.set(id, { running: false, reason: result.reason || t("routine.refused") }); changed(); return;
    }
    const poll = async (): Promise<void> => {
      try {
        const { runs } = await api.routineRuns(id);
        const run = runs.find(item => item.id === result.run_id);
        const running = !run || run.finished === null;
        states.set(id, { running, reason: "", run }); changed();
        if (running) setTimeout(() => void poll(), 1000);
      } catch (error) {
        states.set(id, { ...routineRunState(id), running: true, reason: describeError(error) }); changed();
        setTimeout(() => void poll(), 3000);
      }
    };
    await poll();
  } catch (error) {
    states.set(id, { running: false, reason: describeError(error) }); changed();
  }
}
