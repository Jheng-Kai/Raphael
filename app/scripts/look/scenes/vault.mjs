import { scene, click, hover, type, wait, settings, scroll, check, rightClick } from "./steps.mjs";

const list = [...settings("safety"), wait('.vault-row'), scroll('.vault')];
const editor = kind => [...list, click('[data-vault="new"]'), click(`.menu [data-value="${kind}"]`), wait('#vault-label'), scroll('.vault-form')];
const preview = [...list, { action: "upload", selector: '#vault-file', path: 'scripts/look/fixtures/vault-import.csv' }, wait('[data-vault-import]'), scroll('.vault-editor')];
export default [
  scene('vault-list', 'Shared vault entries, owner hints and member access in Safety', [...list, check('vault-list')]),
  scene('vault-filter', 'Kind filters retain counts and show only the selected rows', [...list, click('[data-vault="filter"][data-kind="card"]'), check('vault-filter')]),
  scene('vault-entry-page', 'Each row has a pencil and no ⋯; it opens the entry\'s own page: the way back, its title, its trash and the close on one row, its values as saved, masked behind an eye', [...list, click('[data-vault="edit"][data-id="sample-login"]'), wait('.vault-form #vault-value-password'), check('vault-page')]),
  scene('vault-entry-remove-ask', 'The page\'s trash asks in its own place, and the second press removes', [...list, click('[data-vault="edit"][data-id="sample-login"]'), wait('.vault-form #vault-value-password'), click('.vault-page-head [data-vault="remove"]'), wait('.vault-page-head [data-asking="true"]'), check('vault-remove-ask')]),
  ...['login','contact','card'].map(kind => scene(`vault-new-${kind}`, `Private ${kind} fields use the shared settings inputs`, [...editor(kind), check(`vault-new-${kind}`)])),
  // The pointer then leaves the row it pressed, so that the picture shows a chosen row as it stays, not as it is hovered.
  scene('vault-sharing', 'Chosen-member access uses the shared dropdown without clearing private form inputs; each member is a row with its face, filled and checked at the right once chosen', [...editor('contact'), type('#vault-label', '出差聯絡資料'), click('[data-k="vault-access"]'), click('.menu [data-value="chosen"]'), wait('[data-vault-member]'), click('[data-vault-member="1"]'), scroll('.vault-members'), hover('.vault-access > span'), check('vault-sharing')]),
  scene('vault-import-preview', 'The owner file opens a selective preview without writing credentials; each entry is a row, filled and checked at the right while chosen', [...preview, click('[data-vault-import="1"]'), hover('.vault-editor h3'), check('vault-preview')]),
  // #320: the Composio key is kept and replaced here, and every entry's values can be changed.
  scene('vault-composio-key', 'A saved Composio key is the vault\'s first key, the whole team\'s, with its ⋯', [...list, check('vault-composio-key')], { composioConfigured: true }),
  scene('vault-composio-edit', 'The Composio key\'s page is the key alone, as saved and masked, with its eye, its trash and the note that the Composio apps must be connected again', [...list, click('[data-vault="edit"][data-id="composio"]'), wait('[data-vault-system="composio"] #vault-value-value'), check('vault-composio-edit')], { composioConfigured: true }),
  scene('vault-edit-values', 'The eye beside a value shows it as text and hides it again; the others stay masked', [...list, click('[data-vault="edit"][data-id="sample-login"]'), wait('.vault-form #vault-value-password'), click('[data-vault="reveal"][data-field="password"]'), check('vault-edit-values')]),
  // Settings has no right click: on a vault row or a rule nothing opens.
  scene('settings-no-right-click', 'A right click on a vault row or anywhere in Safety opens no menu', [...list, rightClick('[data-vault-row="sample-login"]'), check('no-menu-open'), rightClick('.vault-heading h2'), check('no-menu-open')]),
  scene('vault-card-permission', 'Even Allow all requires a card naming the merchant, amount and card label', [wait('[data-permission-card]'), check('vault-payment'), check('card-shell')], { permissionCard: 'tool', vaultPayment: true }),
];
