import { scene, click, hover, type, wait, settings, scroll, check, rightClick } from "./steps.mjs";

const list = [...settings("safety"), wait('.vault-row'), scroll('.vault')];
const editor = kind => [...list, click('[data-vault="new"]'), click(`.menu [data-value="${kind}"]`), wait('#vault-label'), scroll('.vault-editor')];
const preview = [...list, { action: "upload", selector: '#vault-file', path: 'scripts/look/fixtures/vault-import.csv' }, wait('[data-vault-import]'), scroll('.vault-editor')];
export default [
  scene('vault-list', 'Shared vault entries, owner hints and member access in Safety', [...list, check('vault-list')]),
  scene('vault-filter', 'Kind filters retain counts and show only the selected rows', [...list, click('[data-vault="filter"][data-kind="card"]'), check('vault-filter')]),
  scene('vault-entry-menu', 'Entry editing and removal share the existing row action menu', [...list, rightClick('[data-vault-row="sample-login"]'), wait('#app-popover [data-pick="remove"]'), check('vault-menu')]),
  scene('vault-entry-remove-ask', '移除 asks in its own place in the same menu, and the second press removes', [...list, rightClick('[data-vault-row="sample-login"]'), wait('#app-popover [data-pick="remove"]'), click('#app-popover [data-pick="remove"]'), wait('#app-popover [data-pick="remove"][data-asking="true"]'), check('vault-remove-ask')]),
  ...['login','contact','card'].map(kind => scene(`vault-new-${kind}`, `Private ${kind} fields use the shared settings inputs`, [...editor(kind), check(`vault-new-${kind}`)])),
  // The pointer then leaves the row it pressed, so that the picture shows a chosen row as it stays, not as it is hovered.
  scene('vault-sharing', 'Chosen-member access uses the shared dropdown without clearing private form inputs; each member is a row with its face, filled and checked at the right once chosen', [...editor('contact'), type('#vault-label', '出差聯絡資料'), click('[data-k="vault-access"]'), click('.menu [data-value="chosen"]'), wait('[data-vault-member]'), click('[data-vault-member="1"]'), scroll('.vault-members'), hover('.vault-access > span'), check('vault-sharing')]),
  scene('vault-import-preview', 'The owner file opens a selective preview without writing credentials; each entry is a row, filled and checked at the right while chosen', [...preview, click('[data-vault-import="1"]'), hover('.vault-editor h3'), check('vault-preview')]),
  scene('vault-card-permission', 'Even Allow all requires a card naming the merchant, amount and card label', [wait('[data-permission-card]'), check('vault-payment'), check('card-shell')], { permissionCard: 'tool', vaultPayment: true }),
];
