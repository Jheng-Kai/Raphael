import { scene, click, hover, check, page, room, settings, wait } from "./steps.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "../fixture.json"), "utf8"));
const ownerPresets = { presets: [fixture.sidebarOwnerPreset] };

export default [
  scene("sidebar", "One conversation sidebar across Home and dictation", [page("home"), check("sidebar-shell"), page("dictation"), check("sidebar-shell"), page("agent"), check("sidebar-shell")]),
  scene("sidebar-folders", "Open member folders and group chats", [{ action: "member-column", collapsed: false }, check("sidebar-shell")]),
  scene("sidebar-folded", "A collapsed folder preserves its choice", [{ action: "member-column", collapsed: false }, click('[data-group-fold="1"]'), check("sidebar-folded"), check("sidebar-shell")]),
  scene("sidebar-many", "Many colleagues retain a scrollable single list", [{ action: "member-column", collapsed: false }, check("sidebar-shell")], { sidebarMany: true }),
  scene("sidebar-unread", "Unread member and group messages have previews and times", [{ action: "member-column", collapsed: false }, check("sidebar-room-summary"), check("sidebar-unread"), check("sidebar-shell")], { sidebarUnread: true }),
  scene("sidebar-drawer", "Compact menu opens the same full conversation list", [{ action: "member-column", collapsed: false }, check("sidebar-shell")]),
  scene("sidebar-search", "Search opens in place without moving either top control", [{ action:"member-column",collapsed:false },check('sidebar-search-before'),click('[data-col="search"]'),check('sidebar-search-open'),{ action: "search", text: "小晴" }, check("sidebar-shell")]),
  scene("sidebar-plus", "The global plus shares member and group chat creation", [click('[data-col="add"]'), wait('#app-popover [data-pick="group-chat"]'), check("sidebar-shell")]),
  scene("sidebar-group-avatar", "Room header uses the same composite member face", [room(1), check("sidebar-room-summary"), check("sidebar-room-avatar"), check("sidebar-shell")]),
  scene("sidebar-group-avatar-hover", "Unselected, hovered and selected face grids have no outer ring", [room(1), { action: "member-column", collapsed: false }, hover('[data-room-everyone]'), check("sidebar-room-avatar"), check("sidebar-shell")]),
  scene("sidebar-group-avatar-pair", "Two participant faces fill the same grid in sidebar and header", [room(1), { action: "member-column", collapsed: false }, check("sidebar-room-avatar"), check("sidebar-shell")], { rooms: fixture.rooms.map(room => ({...room, member_ids:room.id === 1 ? [0,1] : room.member_ids})) }),
  scene("sidebar-group-avatar-four", "Four participant faces fill a 2 by 2 grid without rings", [room(1),{action:'member-column',collapsed:false},check('sidebar-room-avatar'),check('sidebar-shell')], {rooms:fixture.rooms.map(room=>({...room,member_ids:room.id===1?[0,1,2,3]:room.member_ids}))}),
  scene("sidebar-room-home", "Leaving a group selects Home alone and returning selects that group alone", [room(1), page("home"), check("sidebar-shell"), room(1), check("sidebar-shell")]),
  scene("sidebar-owner", "Account exposes the shared drag and crop avatar picker", [...settings("general"), check("owner-avatar"), click('[data-owner-photo]'), wait('.mb-avpop')], ownerPresets),
  scene("sidebar-owner-preset", "A local avatar preset reaches the account and outgoing messages", [...settings("general"), click('[data-owner-photo]'), click('.mb-avpop [data-preset]'), wait('[data-owner-photo] img'), click('.modal-scrim [data-act="close"]'), check("owner-avatar-saved")], ownerPresets),
  scene("sidebar-owner-upload", "An uploaded and dragged owner photo reaches the account and outgoing messages", [...settings("general"), click('[data-owner-photo]'), click('.mb-avpop [data-pick="0"]'), { action: "upload", selector: 'input.mb-picker', path: 'public/brand/glyph-ring.png' }, wait('.av-crop-view img'), { action: "wheel", selector: '.av-crop-view', deltaY: -200 }, { action: "pointer-drag", selector: '.av-crop-view', dx: 20, dy: -10 }, click('[data-act="crop-done"]'), wait('[data-owner-photo] img'), click('.modal-scrim [data-act="close"]'), check("owner-avatar-saved")]),
];
