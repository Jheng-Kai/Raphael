import chat from "./chat.mjs";
import questions from "./owner-questions.mjs";
import mcp from "./mcp-proposals.mjs";
import pages from "./pages.mjs";
import { scene, check, click, key, member, scroll, type, wait, waitGone } from "./steps.mjs";

const source = [...chat, ...questions, ...mcp, ...pages];
const alias = (name, original) => ({...source.find(scene => scene.name === original), name});
const computer = {running:"fresh",runningMember:1,desktop:{state:"running",ready:true,control:"member",works:[{id:"private-computer-task",request_id:"private-takeover-request",turn_id:2,state:"waiting_control",tool:"get_desktop_state",reason:"sign_in"}]}};
const entry = [member(1),wait('[data-card-desktop-screen] iframe:not([hidden])')];
const hostCard = {computerCard: 'signin', browserHandback: true,
  desktop:{transport:'host',target:'chrome-tab',state:'running',ready:true,control:'member',
    host_request:{id:'card-pc',request_id:'card-pc',turn_id:140,state:'waiting_control',tool:'get_browser_state',reason:'sign_in',detail:'請登入範例帳戶。'}}};
// A page that asks for a client certificate: Chrome opens its own window for the owner (#345); the words carry no model detail.
const certificateCard = {...hostCard, computerReason: 'certificate', desktop: {...hostCard.desktop,
  host_request: {...hostCard.desktop.host_request, reason: 'certificate', detail: ''}}};
// Why Chrome could not choose the certificate by itself (R-COMP-CERT-02): the core says a code and the window says it in words.
const certificateWhy = code => ({...certificateCard, desktop: {...certificateCard.desktop,
  host_request: {...certificateCard.desktop.host_request, detail: code}}});
// Chrome is choosing the certificate itself, with no window: nothing waits for the owner, and the Computer view says what happens.
const certificateAuto = keychain => ({running:"fresh",runningMember:1, desktop:{transport:"host",target:"chrome-tab",state:"running",ready:true,control:"member",
  signing_in:{host:"intranet.example.test",keychain},
  works:[{id:"chrome-tab",turn_id:2,transport:"host",state:"running",tool:"browser_open",reason:""}]}});
const hostCardPreview = [member(1), wait('[data-computer-card="card-pc"] .desktop-last:not([hidden])')];
const hostTake = [...hostCardPreview, click('[data-computer-card="card-pc"] [data-act="card-takeover"].pri'),
  wait('.desktop-panel[data-expanded][data-interactive="true"] iframe[src*="transport=host"]')];
export default [
  ...Object.entries({
    "card-page-ready":"page-product", "card-page-failed":"page-gone", "card-background":"room-question-card",
    "card-mail-ready":"email-draft-edit", "card-mail-discarded":"email-draft-discard",
    "card-question-waiting":"owner-question-asked", "card-question-answered":"owner-question-answered", "card-question-cancelled":"owner-question-cancelled", "card-question-text":"owner-question-text", "card-question-typed":"owner-question-typed",
    "card-permission-waiting":"local-permission-card", "card-approval":"admin-approval", "card-team":"member-draft", "card-team-done":"member-draft-done",
    "card-connect-waiting":"connector-slack", "card-connect-authorizing":"connector-authorizing", "card-connect-done":"connector-reconnected", "card-connect-failed":"connector-invalid-request",
    "card-key-waiting":"connector-key-form", "card-key-done":"connector-key-sent", "card-key-failed":"connector-key-rejected", "card-secret":"chat-secret-masked", "card-secret-failed":"chat-secret-saved-not-resumed",
    "card-computer-done":"chat-handback", "card-mcp-draft":"mcp-proposal-edit", "card-mcp-tested":"mcp-proposal-tested", "card-mcp-done":"mcp-proposal-enabled", "card-mcp-cancelled":"mcp-proposal-cancelled",
  }).map(([name, original]) => { const found=alias(name,original); if(!found.steps) throw new Error(`Missing card scene ${original}`); return found; }),
  ...['once','always','deny'].map(choice=>scene(`card-permission-${choice}`,`The ${choice} answer settles the original permission`,[wait('[data-permission-card]'),click(`[data-act="perm-${choice}"]`),wait('[data-permission-card]:not([data-card-state=pending])'),check('card-permission-settled')],{permissionCard:'tool'})),
  ...[['expired','已逾時'],['cancelled','已取消']].map(([state,words])=>scene(`card-connect-${state}`,`A ${state} connection card names how it ended`,[wait(`[data-connector="card-slack"][data-card-state="${state}"]`),check(`card-connect-ended:${words}`)],{connectorCard:'slack',connectorState:state})),
  // R-LINK-01: a long address in brackets in a card's words is a link inside the card's width; pressed, it opens and nothing of the card is answered.
  scene('urls-card','The address in the words of a card is a link that wraps inside the card and opens in the browser', [wait('[data-permission-card] .card-body .message-link'),click('[data-permission-card] .card-body .message-link'),check('urls-are-links')],{permissionCard:'tool',linkedReason:true}),
  scene('card-login','Login credentials stay masked in the card',[member(1),wait('[data-login-user]'),type('[data-login-user]','reader@example.invalid'),type('[data-secret-input]','synthetic-password'),check('card-shell')],{loginCard:true}),
  scene('card-question-key','A focused question takes B, while typing A stays in the answer field', [member(1),wait('[data-owner-question="owner-choice"]'),type('[data-owner-answer-input]','A'),check('card-question-typing'),click('[data-owner-question="owner-choice"] .card-title'),key('b'),wait('[data-card-state="answered"]'),check('card-question-key')],{ownerQuestion:'asked'}),
  scene('card-computer-waiting','The existing live stream sits inside the waiting card', [...entry,check('card-computer-inline')],computer),
  scene('desktop-host-no-card', 'Chrome work opens the Computer tab by itself and puts no card in the conversation',
    [member(1), wait('.desktop-screen[data-host-browser] iframe[src*="transport=host"]:not([hidden])'), check('desktop-host-no-card'), check('desktop-host-frame')],
    {running:"fresh",runningMember:1, desktop:{transport:"host",target:"chrome-tab",state:"running",ready:true,control:"member",
      works:[{id:"chrome-tab",turn_id:2,transport:"host",state:"running",tool:"browser_open",reason:""}]}}),
  scene('desktop-host-card', 'The Chrome sign-in card preserves the page aspect',
    [...hostCardPreview, check('desktop-host-card-frame')], hostCard),
  scene('desktop-host-certificate-card', 'A page that needs a certificate says a Chrome window opened on the screen and which button ends the step',
    [...hostCardPreview, check('desktop-host-certificate')], certificateCard),
  scene('desktop-host-certificate', 'The same words stand in the larger view above the live page',
    [...hostTake, wait('[data-desktop="return"]:not([hidden])'), check('desktop-host-certificate')], certificateCard),
  scene('desktop-host-certificate-auto', 'While Chrome chooses the certificate by itself the Computer view says so, and no card waits for the owner',
    [member(1), wait('.desktop-screen[data-host-browser] iframe[src*="transport=host"]:not([hidden])'), wait('[data-computer-state-text]'),
      check('desktop-host-certificate-auto')], certificateAuto(false)),
  scene('desktop-host-certificate-auto-keychain', 'The first time on a Mac, the view also says what macOS may ask and what to choose',
    [member(1), wait('.desktop-screen[data-host-browser] iframe[src*="transport=host"]:not([hidden])'), wait('[data-computer-state-text]'),
      check('desktop-host-certificate-auto:keychain')], certificateAuto(true)),
  scene('desktop-host-certificate-unmatched-card', 'When Chrome could not choose a certificate the card says so, then the window and the button',
    [...hostCardPreview, check('desktop-host-certificate-why:unmatched')], certificateWhy('certificate_unmatched')),
  scene('desktop-host-certificate-refused-card', 'When the computer did not let Chrome use the certificate the card says so, then the window and the button',
    [...hostCardPreview, check('desktop-host-certificate-why:refused')], certificateWhy('certificate_refused')),
  scene('desktop-host-certificate-unmatched', 'The same sentence stands in the larger view above the live page',
    [...hostTake, wait('[data-desktop="return"]:not([hidden])'), check('desktop-host-certificate-why:unmatched')], certificateWhy('certificate_unmatched')),
  scene('desktop-host-takeover', 'Take control opens Chrome in the large viewer and a title bar press preserves the same page and owner input',
    [...hostTake, wait('[data-desktop="return"]:not([hidden])'), check('desktop-stream'), click('.window-chrome [data-window-drag]'),
      check('desktop-host-outside-press'), {action:'desktop-owner-typing'}, check('desktop-host-frame')], hostCard),
  scene('desktop-host-tabs-popup', 'A sign-in popup is the selected tab and takes input in the enlarged view',
    [...hostTake, wait('[data-browser-tab="popup"][aria-pressed="true"]'), {action:'desktop-owner-typing'},
      check('desktop-host-frame'), check('desktop-host-tabs-control'), check('desktop-host-tabs-popup')], {...hostCard, hostTabs:'popup'}),
  scene('desktop-host-handback', 'Done returns the host browser tab from the same viewer',
    [...hostTake, click('[data-desktop="return"]'), waitGone('[data-computer-card="card-pc"]'), check('host-handoff-returned')], hostCard),
  scene('desktop-host-skip-idle', 'Skipping a Chrome sign-in removes the card and leaves the Computer tab idle',
    [member(1), wait('[data-computer-card="card-pc"]'), click('[data-computer-card="card-pc"] [data-act="card-stop"]'),
      waitGone('[data-computer-card="card-pc"]'), {action:'open-computer'}, wait('.desktop-panel:not([hidden])[data-desktop-state="idle"]'),
      check('computer-panel-quiet'), check('host-handoff-skipped')], hostCard),
  // R-PANEL-09: a sign-in is no work for a small picture. The card's screen and its 接手 carry the same stream into the larger view,
  // where the owner's input reaches it and the pill's 我完成了 gives the request back once.
  scene('card-computer-takeover','A click on the card screen takes the same stream into the larger view under the owner hands without reconnecting', [...entry,click('[data-card-desktop-screen] button'),wait('.desktop-panel[data-expanded][data-interactive="true"] .desktop-screen iframe'),{action:'desktop-owner-typing'},check('computer-takeover-owner')],computer),
  scene('card-computer-handback','Done in the larger view pill hands back the same nonce once and removes the card', [...entry,click('[data-card-desktop="take"].pri'),wait('.desktop-panel[data-expanded][data-interactive="true"]'),click('[data-desktop="return"]'),waitGone('.computer-card'),check('computer-takeover-done')],computer),
  scene('card-send-failed','A failed message returns to the composer with a local retry', [member(1),type('.cmp-input','Please review the project note.'),click('.cmp-send'),wait('.composer-failure [data-card-retry]'),check('card-send-failed')],{cardSendFailure:true}),
  scene('card-send-retry','Retry delivers the restored words once more', [member(1),type('.cmp-input','Please review the project note.'),click('.cmp-send'),wait('[data-card-retry]'),click('[data-card-retry]'),wait('.cmp-input'),check('card-send-retry')],{cardSendFailure:true}),
  scene('card-mail-failed','Failed mail retains its editable version', [member(1),wait('[data-mail-card]'),click('[data-act="mail-send"]'),wait('[data-mail-state="failed"]'),check('card-mail-failed')],{mailDraft:'draft',cardMailFailure:true}),
  scene('card-mail-retry','Explicit mail retry creates a new version and sends once', [member(1),wait('[data-mail-card]'),click('[data-act="mail-send"]'),wait('[data-mail-state="failed"]'),click('[data-act="mail-send"]'),wait('[data-mail-state="sent"]'),check('card-mail-retry')],{mailDraft:'draft',cardMailFailure:true}),
  scene('card-message-waiting','Connected message fields stay folded until reviewed', [wait('[data-permission-card]'),click('[data-card-disclosure]'),check('card-message')],{permissionCard:'tool',cardMessagePreview:true}),
  ...['once','deny'].map(choice=>scene(`card-message-${choice}`, 'One original approval settles the same connected message draft', [wait('[data-permission-card]'),click(`[data-act="perm-${choice}"]`),wait('[data-permission-card]:not([data-card-state=pending])'),click('[data-card-disclosure]'),check('card-message')],{permissionCard:'tool',cardMessagePreview:true})),
  scene('card-message-failed','Failed approval keeps the connected message draft', [wait('[data-permission-card]'),click('[data-act="perm-once"]'),wait('[data-card-retry]'),click('[data-card-disclosure]'),check('card-message')],{permissionCard:'tool',cardMessagePreview:true,cardPermissionFailure:true}),
  scene('card-message-retry','Retry settles the original connected message approval once', [wait('[data-permission-card]'),click('[data-act="perm-once"]'),wait('[data-card-retry]'),click('[data-card-retry]'),wait('[data-permission-card]:not([data-card-state=pending])'),click('[data-card-disclosure]'),check('card-message')],{permissionCard:'tool',cardMessagePreview:true,cardPermissionFailure:true}),
  scene('card-mail-close','Closing failed mail leaves the draft unsent', [member(1),wait('[data-mail-card]'),click('[data-act="mail-send"]'),wait('[data-mail-state="failed"]'),click('[data-mail-card] [data-card-failed-close]'),check('card-failed-close')],{mailDraft:'draft',cardMailFailure:true}),
  scene('card-page-close','Closing an unavailable page does not open it again', [member(1),wait('.pg-failed:not([hidden])'),click('.pg-card > .card-head [data-card-failed-close]'),check('card-failed-close')],{pageTurn:true,pageGone:true}),
  (() => { const failed=alias('card-connect-close','connector-invalid-request'); return {...failed, steps:[...failed.steps,click('[data-connector] [data-card-failed-close]'),check('card-failed-close')]}; })(),
  (() => { const key=alias('card-key-guide-retry','connector-key-form'); return {...key, fixture:{...key.fixture,cardLinkFailure:true}, steps:[...key.steps,click('[data-inline-setup] [data-card-disclosure]'),click('[data-inline-setup] [data-dlg="guide"]'),wait('[data-card-retry]'),click('[data-card-retry]'),check('card-guide-retry')]}; })(),
  scene('card-task-no-file-card','A finished turn of a member whose computer changed files shows its reply and no file card',[member(1),wait('.tn[data-id="980"] [data-message="reply"] .message-text'),check('card-task-no-file-card')],{cardTaskResult:true}),
  {...scene('card-sheet','Production cards in one conversation column', [member(1),wait('.tn[data-id="980"]'),wait('[data-card-desktop-screen] iframe:not([hidden])'),scroll('.tn[data-id="980"]'),check('card-sheet')],{cardDeck:true}), captureColumn:true},
].map(scene => scene.name.startsWith('card-message-') ? {...scene, captureColumn:true} : scene);
