// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { faceHTML } from "./members";
import { followSlimeRoster, setSlimeState } from "./slime";
import { threadLineIdentity } from "./thread-diff";

const line = (member: { id: number; name: string; avatar?: string }, words = "Reading"): string =>
  `<li class="tn" data-key="turn:1"><div class="ra-body"><div class="chat-message">The reply</div>` +
  `<div class="live-presence" role="status">${faceHTML(member, 28, { moving: true })}<span class="live-action">${words}</span></div></div></li>`;

test("a line keeps its identity when only the state or the words of a member's face change", () => {
  const ada = { id: 331, name: "Ada", avatar: "slime:shion" };
  followSlimeRoster([{ id: 331, activity: "thinking" }]);
  const thinking = line(ada);
  followSlimeRoster([{ id: 331, activity: "working", activity_label: "Reading sample.md" }]);
  setSlimeState(331, "working", "Reading sample.md");
  const working = line(ada);
  // The two draw differently (a state has its own strips), and are the same line.
  expect(working).not.toBe(thinking);
  expect(threadLineIdentity(working)).toBe(threadLineIdentity(thinking));
  // The words of the line are still part of it.
  expect(threadLineIdentity(line(ada, "Writing"))).not.toBe(threadLineIdentity(working));
  // Another member, or another slime, is another line.
  expect(threadLineIdentity(line({ ...ada, id: 332 }))).not.toBe(threadLineIdentity(working));
  expect(threadLineIdentity(line({ ...ada, avatar: "slime:souei" }))).not.toBe(threadLineIdentity(working));
  // A picture of a slime (a reply's face in a group) keeps its hover words out of the line as well.
  const still = (label: string): string => { setSlimeState(333, "idle", label); return `<li class="tn">${faceHTML({ id: 333, name: "Bo" }, 28)}</li>`; };
  expect(threadLineIdentity(still("one"))).toBe(threadLineIdentity(still("two")));
  expect(still("one")).not.toBe(still("two"));
});
