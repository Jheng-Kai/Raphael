import colleagues from "./colleagues.mjs";
import memberStore from "./member-store.mjs";
import cards from "./cards.mjs";
import chatMetadata from "./chat-metadata.mjs";
import vault from "./vault.mjs";
import calmThread from "./calm-thread.mjs";
import appUpdates from "./app-updates.mjs";
import polish from "./polish.mjs";
import handoffGroup from "./handoff-group.mjs";
import menus from "./menus.mjs";
import presence from "./presence.mjs";
import sidebar from "./sidebar.mjs";
import foot from "./foot.mjs";
import pressThrough from "./press-through.mjs";
import openerToggle from "./opener-toggle.mjs";
import shortcuts from "./shortcuts.mjs";
import routineWorkflow from "./routine-workflow.mjs";
import daily from "./daily.mjs";
import batch from "./batch.mjs";
import workBatch from "./work-batch.mjs";
import mediaData from "./media-data.mjs";
import missing from "./missing.mjs";
import ownerQuestions from "./owner-questions.mjs";
import mcpProposals from "./mcp-proposals.mjs";
import slime from "./slime.mjs";
import pages from "./pages.mjs";
import quota from "./quota.mjs";
import richContent from "./rich-content.mjs";
import answerForms from "./answer-forms.mjs";
import unreadDivider from "./unread-divider.mjs";
import threadWindow from "./thread-window.mjs";
import follow from "./follow.mjs";
import chat from "./chat.mjs";
import topRow, { TOP_ROW_SCENES } from "./top-row.mjs";
import desktop from "./desktop.mjs";
import memberPanel from './member-panel.mjs';
import memberSettings from './member-settings.mjs';
import automations from "./automations.mjs";
import mentions from "./mentions.mjs";
import history from "./history.mjs";
import composerVoice from "./composer-voice.mjs";
import settings from "./settings.mjs";
import overlay from "./overlay.mjs";
import languageOverlay from "./language-overlay.mjs";
import apps from "./apps.mjs";
import connectApps from "./connect-apps.mjs";
import contextMenu from "./context-menu.mjs";
import ownerRound from "./owner-round.mjs";
import ownerRound3 from "./owner-round3.mjs";
import ownerRound10 from "./owner-round10.mjs";
import ownerRound9 from "./owner-round9.mjs";
import { withOwnerRound4, noNaming } from "./owner-round4.mjs";

export const scenes = withOwnerRound4([...polish, ...mcpProposals, ...workBatch, ...batch, ...missing, ...ownerQuestions, ...richContent, ...sidebar, ...foot, ...shortcuts, ...slime, ...pages, ...chat, ...desktop, ...automations, ...mentions, ...history, ...composerVoice, ...settings, ...apps, ...contextMenu, ...overlay, ...ownerRound, ...ownerRound3, ...ownerRound9, ...ownerRound10, noNaming]);
scenes.push(...colleagues);
scenes.push(...memberStore);
scenes.push(...mediaData);
scenes.push(...handoffGroup);
scenes.push(...daily);
scenes.push(...menus);
scenes.push(...cards);
scenes.push(...calmThread, ...chatMetadata, ...vault);
scenes.push(...appUpdates);
scenes.push(...presence);
scenes.push(...answerForms);
scenes.push(...unreadDivider);
scenes.push(...languageOverlay);
scenes.push(...routineWorkflow);
scenes.push(...threadWindow);
scenes.push(...follow);
scenes.push(...memberPanel);
scenes.push(...memberSettings);
scenes.push(...quota);
scenes.push(...pressThrough);
scenes.push(...openerToggle);
scenes.push({name:'motion-cost-details',description:'Isolated emblem decoder and single large vector cost',fixture:{},motion:true,steps:[{action:'motion-details'}]});
scenes.push({name:'motion-cost-comparison',description:'Identical mixed-state fixture and sampling window, starting revision versus current cels',fixture:{},motion:true,steps:[{action:'motion-cost',revision:'e2143ec7'},{action:'motion-cost'}]});
for (const scene of scenes) if (['admin-approval','room-question-card','composer-stop-voice'].includes(scene.name)) {
  scene.motion=true;
  scene.steps.push({action:'motion-audit'});
}
for (const scene of scenes) if (['slime-states', 'presence-states-sidebar', 'busy-team-thread', 'busy-team-room', 'running'].includes(scene.name)) {
  scene.motion = true;
  const freeze = scene.steps.findIndex(step => step.action === 'freeze-motion');
  scene.steps.splice(freeze < 0 ? scene.steps.length : freeze, 0, { action: 'motion-cost', ...(process.env.LOOK_TRACE==='1'?{measure:{name:'motion-cost',enforce:false}}:{}) });
}
scenes.push(...connectApps);
// R-FLOAT-01: what floats (a dialog, a menu, a popover, a floating card) stands on the floating surface and its edge in every theme.
const FLOAT_SCENES = new Set(['member-delete-ask', 'member-maker', 'context-menu-member', 'composer-model-small', 'composer-model-sources', 'automations-detail-own', 'automations-create-slot', 'appearance-menu', 'model-choices-answer', 'profile', 'connections-add-menu', 'server-menu', 'connections-delete']);
// R-FLOAT-02: inside a floating surface an inner card is the surface with a 1 px edge, a control is filled with the control colour: every tab of Settings and every
// dialog, menu and popover that holds cards, fields, rows and wells.
export const FLOAT_CARD_SCENES = new Set(['profile', 'appearance', 'models', 'dictation', 'tools', 'safety', 'about', 'usage', 'usage-allowances-chatgpt', 'model-choices-answer', 'model-choices-local', 'chooser-chatgpt-signed-out',
  'quick-model-menu', 'quick-effort-menu', 'cli-account-menu', 'member-maker', 'member-maker-chosen', 'slime-picker', 'member-avatar', 'member-delete-ask', 'context-menu-member', 'foot-account-menu', 'foot-usage-submenu', 'foot-usage-two',
  'composer-model-small', 'composer-model-sources', 'composer-model-favorites', 'automations-detail-own', 'automations-create-slot', 'automations-create-time-menu', 'emoji-picker', 'connections', 'connections-add-menu',
  'plugins-detail', 'connect-apps', 'connect-apps-more', 'connect-app-oauth', 'connect-app-connected', 'vault-new-login', 'missing-vision', 'primary-contact-picker', 'settings-chatgpt-row',
  'template-preview', 'template-review-pages', 'template-export-review', 'details-routine-view', 'room-rename', 'sidebar-owner-crop', 'computer-file-confirm', 'connections-command', 'connections-edit', 'automations-detail-routine', 'automations-create-button', 'member-template-gallery', 'missing-provider-repair', 'missing-search-repair']);
for (const scene of scenes) if (FLOAT_CARD_SCENES.has(scene.name)) scene.steps.push({ action: "check", name: "float-cards" });
for (const scene of scenes) if (FLOAT_SCENES.has(scene.name)) scene.steps.push({ action: "check", name: "float-surface" });
// Three layers (owner, 2026-11-14): outside the dialog the window under the scrim, the dialog and its nav, then the cards on it, each lighter than the one outside it.
// Settings (a pane with its groups) and 連結應用程式 (its list, its connected list and an app's page with its boxes) read the computed colours of the three layers.
export const DIALOG_LAYER_SCENES = new Set(['profile', 'appearance', 'models', 'usage', 'safety', 'connect-apps', 'connect-apps-connected', 'connect-app-oauth', 'connect-app-connected']);
for (const scene of scenes) if (DIALOG_LAYER_SCENES.has(scene.name)) scene.steps.push({ action: "check", name: "dialog-layers" });
scenes.push(...topRow);
for (const scene of scenes) if (TOP_ROW_SCENES.has(scene.name)) scene.steps.push({ action: "check", name: "conversation-top-row" });
if (new Set(scenes.map(scene => scene.name)).size !== scenes.length) throw new Error("Duplicate look scene name");
