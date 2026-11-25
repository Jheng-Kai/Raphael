import { scene, member, wait, waitGone, click, check, cliSigninEnds } from "./steps.mjs";

const SIGNIN = '.chat-message[data-reply] > .turn-signin [data-act="cli-signin"]';
const CANCEL = '.chat-message[data-reply] > .turn-signin [data-act="cli-signin-cancel"]';
const LINE = '.signin-chip [data-act="notice-signin"]';

export default [
  scene("calm-thread", "Synthetic zh-TW routine failure at 07:00 and owner retry at 08:00", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread")], {calmThread:true}),
  scene("calm-thread-days", "A calm thread crossing two calendar days", [member(1), wait('.tn[data-id="8102"]'), check("calm-thread-days")], {calmThread:"days"}),
  // Run again under a routine's failed run: the failure leaves and the new attempt stands alone; a failure again stands alone too.
  scene("routine-rerun", "Run again under a failed routine run replaces the failure with the new attempt's progress", [member(1), wait('.tn[data-id="8101"] [data-act="rerun"]'), check("routine-rerun-before"), click('.tn[data-id="8101"] [data-act="rerun"]'), waitGone('.tn[data-id="8101"]'), wait('.tn[data-status="running"]'), check("routine-rerun")], {calmThread:true, routineRerun:true}),
  scene("routine-rerun-again", "A run that fails again after Run again leaves only its own failure", [member(1), wait('.tn[data-id="8101"] [data-act="rerun"]'), click('.tn[data-id="8101"] [data-act="rerun"]'), waitGone('.tn[data-id="8101"]'), wait('.tn .chat-message[data-reply] .rerun'), check("routine-rerun-again")], {calmThread:true, routineRerun:"again"}),
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
  // A sign-in lost under an earlier reply, with newer turns after it (a routine's run has no button of its own): the line above
  // the composer says so with 重新登入 whatever came after, and leaves when the sign-in is back (R-CLI-SIGNIN-06).
  scene("chat-cli-line", "Claude Code's lost sign-in stands above the composer with 重新登入 after newer turns", [member(1), wait(LINE), check("cli-signin-line")], {cliSigninLine:true}),
  scene("chat-cli-line-done", "Pressing the line's 重新登入 waits beside 取消, and the line leaves once the sign-in is back",
    [member(1), wait(LINE), click(LINE), wait('.signin-chip [data-act="notice-signin-cancel"]'), check("cli-signin-line-waiting"),
      cliSigninEnds("claude", "done"), waitGone(".signin-chip"), check("cli-signin-line-done")], {cliSigninLine:true}),
];
