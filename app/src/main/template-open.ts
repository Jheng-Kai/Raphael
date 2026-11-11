// A member template file opened from the file manager (double-click on an installed release) reaches the import review.
// The shell reads the file and keeps its text (template_file.rs); the window takes it once, here, and shows the same review
// as the creator's 開啟 button: nothing is added before the owner presses 加入.
import type { MainEvent, PageId } from "./types";

export interface TemplateOpenTarget {
  /** The first-run guide is on screen: it stays in front, and the file waits for the end of it. */
  inGuide(): boolean;
  /** The text of the file that was opened, once (`member_template_pending`); null when there is none. */
  take(): Promise<string | null>;
  go(page: PageId): void;
  /** Shows the import review of the file's text (members-shell.ts). */
  review(text: string): void;
}

/** Takes the file that was opened, if there is one and the window is free to show it. True when its review was opened. */
export async function openPendingTemplate(target: TemplateOpenTarget): Promise<boolean> {
  if (target.inGuide()) return false;
  const text = await target.take();
  if (text === null) return false;
  target.go("agent");
  target.review(text);
  return true;
}

/** The shell's word that a file was opened while the app ran. */
export function followTemplateFile(event: MainEvent, target: TemplateOpenTarget): void {
  if (event.type === "TemplateFile") void openPendingTemplate(target).catch((error) => console.warn("main: the opened template file was not shown", error));
}
