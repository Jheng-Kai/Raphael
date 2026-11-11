import { scene, member, wait, waitGone, click, check, cliSigninEnds } from "./steps.mjs";

const SIGNIN = '.chat-message[data-reply] > .turn-signin [data-act="cli-signin"]';
const CANCEL = '.chat-message[data-reply] > .turn-signin [data-act="cli-signin-cancel"]';

export default [
  scene("calm-thread", "Synthetic zh-TW routine failure at 07:00 and owner retry at 08:00", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread")], {calmThread:true}),
  scene("calm-thread-days", "A calm thread crossing two calendar days", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread-days")], {calmThread:"days"}),
  scene("chat-usage-limit", "A reply that failed on ChatGPT's usage limit leads with Manage usage under its words", [member(1), wait('[data-act="manage-usage"]'), check("chat-usage-limit")], {usageLimit:true}),
  // A reply that failed for want of its subscription CLI's sign-in: the core's one sentence, and under it the one button that mends it.
  scene("chat-cli-expired", "A reply that failed because Claude Code's sign-in ran out says so in one sentence, with only 重新登入 under it", [member(1), wait(SIGNIN), check("chat-cli-signin")], {cliSignin:"expired"}),
  scene("chat-cli-signed-out", "A reply that failed because Codex was never signed in says so, with only 登入 under it", [member(1), wait(SIGNIN), check("chat-cli-signin")], {cliSignin:{cause:"signed_out", cli:"codex"}}),
  scene("chat-cli-not-installed", "A reply that failed because Antigravity is not installed says so, with only its install guide under it", [member(1), wait('.chat-message[data-reply] > .turn-signin [data-act="cli-install"]'), check("chat-cli-signin")], {cliSignin:{cause:"not_installed", cli:"gemini"}}),
  // The same reply at each stand of the sign-in, one image each: the CLI's window open, closed first, and finished.
  scene("chat-cli-signin-waiting", "While Claude Code's own window is open the reply says to finish there, with 取消 beside it", [member(1), wait(SIGNIN), click(SIGNIN), wait(CANCEL), check("chat-cli-signin-waiting")], {cliSignin:"expired"}),
  scene("chat-cli-signin-stopped", "A window closed before the sign-in finished says so and the button is usable again", [member(1), wait(SIGNIN), click(SIGNIN), wait(CANCEL), cliSigninEnds("claude", "stopped"), wait('.turn-signin[data-phase="stopped"]'), check("chat-cli-signin-stopped")], {cliSignin:"expired"}),
  scene("chat-cli-signin-done", "A finished sign-in says the question goes again, and it goes once", [member(1), wait(SIGNIN), click(SIGNIN), wait(CANCEL), cliSigninEnds("claude", "done"), wait('.turn-signin[data-phase="done"]'), waitGone(CANCEL), check("chat-cli-signin-done")], {cliSignin:"expired", askUntilAnswered:true}),
  scene("chat-cli-signin-flow", "Pressing 重新登入 waits for the CLI's own window beside 取消, a window closed first says so and keeps the button, a finished sign-in sends the question again once",
    [member(1), wait(SIGNIN), click(SIGNIN), wait(CANCEL), check("chat-cli-signin-waiting"),
      click(CANCEL), wait(SIGNIN), click(SIGNIN), wait(CANCEL), cliSigninEnds("claude", "stopped"), wait('.turn-signin[data-phase="stopped"]'), check("chat-cli-signin-stopped"),
      click(SIGNIN), wait(CANCEL), cliSigninEnds("claude", "done"), wait('.turn-signin[data-phase="done"]'), waitGone(CANCEL), check("chat-cli-signin-done")],
    {cliSignin:"expired", askUntilAnswered:true}),
];
