// Navigation requests stay additive: the conversation page owns how its thread is loaded.
import type { AppContext } from "./types";
export function openMemberThread(app: AppContext, memberId: number, turnId?: number, draft?: string): void {
  app.go("agent");
  window.dispatchEvent(new CustomEvent("raphael:open-member", { detail: { memberId, turnId, ...(draft === undefined ? {} : { draft }) } }));
}
