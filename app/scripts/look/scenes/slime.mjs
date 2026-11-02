import { scene, click, check, member, wait } from "./steps.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixture.json"), "utf8"));

const doing = (member_id, state) => ({ action: "main-event", event: { type: "MemberActivity", member_id, state } });
const board = (rows, columns) => ({ action: "slime-board", rows, columns });

const SKY = { color: "sky" }, SHION = { character: "shion" }, BENIMARU = { character: "benimaru" }, RIGURD = { character: "rigurd" }, TREYNI = { character: "treyni" };
const SIDEBAR = 40, LARGE = 72;

// Every size the app really draws a slime at, from a calendar chip up to the maker, beside one of the app's own icons.
const SIZES = [18, 19, 20, 22, 24, 26, 28, 30, 34, 36, 40, 44, 48, 64, 72, 88, 96, 104, 120];
const sizes = (label, slime, hat) => ({ label, cells: [20, 40].map(size => ({ icon: true, size, caption: size })).concat(SIZES.map(size => ({ size, slime, hat, caption: size }))) });

// Every state at the sidebar's size and a large one, each held at a moment that tells it.
const TELLING = [["閒著", "idle", 3000], ["思考", "thinking", 1000], ["工作", "working", 150], ["搜尋", "searching", 1800], ["電腦", "computer", 120], ["等待", "waiting", 2760], ["等你", "blocked", 700], ["完成", "done", 400], ["出錯", "error", 1600], ["睡覺", "sleeping", 2200], ["登場", "arriving", 372]];
const gallery = slime => TELLING.map(([label, state, at]) => ({ label, cells: [{ size: SIDEBAR, slime: SKY, state, at }, { size: 96, slime: SKY, state, at }, { size: SIDEBAR, slime, state, at }, { size: 96, slime, state, at }] }));

// A strip of frames across a stretch of motion, with a mark that swings at the large size and the plain slime at the sidebar's.
const strip = (label, state, times, slime = SHION) => [
  { label, paddingTop: state === "arriving" ? 28 : 0, cells: times.map(at => ({ size: LARGE, slime, state, at, caption: at })) },
  { paddingTop: state === "arriving" ? 16 : 0, cells: times.map(at => ({ size: SIDEBAR, slime: SKY, state, at })) },
];
const change = (label, state, at, then, slime = SHION) => ({ label, cells: [{ size: LARGE, slime, state, at, caption: "前" }, ...[0, 40, 90, 150, 220, 320, 460].map(after => ({ size: LARGE, slime, state, at, then, after, caption: after }))] });

const sharp = [20, 40].map(size => ({ icon: true, size, caption: size })).concat(SIZES.map(size => ({ size, slime: SKY, state: "idle" })));

const periods = { idle: 23300, thinking: 2800, working: 1800, searching: 3200, computer: 1700, waiting: 6000, blocked: 1800, done: 1900, error: 6000, sleeping: 5600, arriving: 1200 };
const liquidSheet = TELLING.map(([label, state]) => ({ label, cells: [0, .25, .5, .75].flatMap(phase => [22, 28, 40].map(size => ({ size, slime: phase === .5 ? SHION : SKY, state, at: state === "working" ? [0, 162, 882, 1062][[0, .25, .5, .75].indexOf(phase)] : Math.round(periods[state] * phase), caption: `${size}/${state === "working" ? [0, 9, 49, 59][[0, .25, .5, .75].indexOf(phase)] : phase * 100}%` }))) }));
const stillSheet = TELLING.map(([label, state]) => ({ label, cells: [22, 28, 40].flatMap(size => [{ size, slime: SKY, state, at: 0, caption: size }, { size, slime: SHION, state, at: 0, caption: size }, { size, slime: SKY, hat: true, state, at: 0, caption: size }]) }));

export default [
  { ...scene("slime-liquid-sheet", "Our liquid body language at 22, 28 and 40 pixels, sampled across each loop", [board(liquidSheet), { action: "slime-parts" }]), motion: true },
  scene("slime-liquid-still", "Reduced motion retains a distinct body, eyes and liquid prop in every state", [board(stillSheet), check("slime-liquid-still"), { action: "slime-parts" }]),
  { ...scene("slime-parts", "Eyes and hats stay with the body at every drawn size throughout every state loop", [board(TELLING.map(([label, state]) => ({label, cells: [{size: 20, height: 19, slime: SKY, state, hat: true, at: 0}, ...[19, 22, 26, 28, 30, 40, 48, 72].map(size => ({size, slime: SKY, state, hat: true, at: 0}))]})), 2), {action: "slime-parts"}]), motion: true },
  { ...scene("slime-states", "Each member's slime moves with what that member is doing", [{ action: "member-column", collapsed: false }, doing(1, "thinking"), doing(2, "working"), doing(3, "computer"),
    { action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: { name: "roster-motion", enforce: false }, limits: { replacedFaces: 0, longTaskMs: 600 } },
    check("slime-states"), { action: "freeze-motion", at: 450 }]), motion: true },
  scene("slime-picker", "A member's slime is a character or a colour, tried in a menu that stays open", [member(1), { action: "open-details" }, wait(".mb-det:not([hidden])"), click('[data-det="gear"]'), click(".mb-avbtn"), wait(".mb-avpop"), click('.mb-avpop [data-slime-color="coral"]'), click('.mb-avpop [data-slime-character="shion"]'), check("slime-picker")]),
  scene("slime-sizes", "A slime at every size the app draws it, at rest, as sharp as the icon beside it", [board([sizes("素色", SKY), sizes("角", SHION), sizes("帽", SKY, true)])]),
  { ...scene("slime-gallery", "Every state at the sidebar's size and the large one", [board(gallery(SHION), 2)]), motion: true },
  { ...scene("slime-motion-idle", "Alive and curious: a breath, a blink, a look around and an occasional wobble", [board([
    ...strip("呼吸", "idle", [0, 500, 1000, 1500, 1900, 2400, 3000, 3600]),
    ...strip("眨眼", "idle", [420, 450, 480, 540, 590, 640, 680, 760]),
    ...strip("張望", "idle", [1400, 1500, 2300, 2450, 3200, 3350, 5170, 6000]),
    ...strip("晃晃", "idle", [13200, 13514, 13700, 13980, 14100, 14446, 14700, 14912]),
  ])]), motion: true },
  { ...scene("slime-motion-busy", "Thinking, working, searching and at the computer, each its own small performance", [board([
    ...strip("思考", "thinking", [0, 500, 1000, 1500, 1800, 2300, 2800, 3300]),
    ...strip("工作", "working", [0, 100, 162, 360, 610, 720, 810, 882], BENIMARU),
    ...strip("搜尋", "searching", [0, 380, 860, 1000, 1250, 1540, 1980, 2450], TREYNI),
    ...strip("電腦", "computer", [0, 120, 240, 360, 600, 840, 1200, 1580], RIGURD),
  ])]), motion: true },
  { ...scene("slime-motion-moments", "Waiting, a joyful finish, a sad deflate, sleep and an arrival", [board([
    ...strip("等待", "waiting", [2400, 2590, 2760, 2900, 3070, 3220, 3650, 4600]),
    ...strip("完成", "done", [0, 210, 400, 590, 780, 880, 1140, 1340]),
    ...strip("等你", "blocked", [0, 200, 450, 700, 900, 1200, 1500, 1800]),
    ...strip("出錯", "error", [0, 144, 480, 740, 990, 1280, 1480, 1600]),
    ...strip("睡覺", "sleeping", [0, 700, 1400, 2130, 2600, 3300, 4200, 5000]),
    ...strip("登場", "arriving", [0, 96, 288, 372, 528, 660, 820, 1100]),
  ])]), motion: true },
  { ...scene("slime-motion-change", "Between states nothing jumps: each row starts from the pose before it, and the change is a small moment", [board([
    change("閒→工", "idle", 16850, "working"),
    change("工→思", "working", 150, "thinking"),
    change("思→搜", "thinking", 1000, "searching"),
    change("搜→完", "searching", 1540, "done"),
    change("完→閒", "done", 1140, "idle"),
    change("工→錯", "working", 400, "error"),
    change("閒→等", "idle", 8050, "waiting"),
  ]), check("slime-handover")]), motion: true },
  { ...scene("slime-sharp", "Running idle, active and transitioning poses retain the static vector's sharp edge", [board([{ label: "閒置", cells: sharp }, { label: "動作", cells: TELLING.slice(1).flatMap(([caption, state, at]) => [40, 96].map(size => ({ size, slime: SKY, state, at, caption }))) }, { label: "轉場", cells: [40, 72, 96].map(size => ({ size, slime: SKY, state: "working", at: 150, then: "thinking", after: 90 })) }]), { action: "slime-sharp" }]), motion: true },
  { ...scene("slime-pointer", "Under the pointer a slime wiggles, and a press squashes it until it is let go", [{ action: "member-column", collapsed: false }, { action: "slime-pointer", selector: '.mb-row[data-member="1"]' }]), motion: true },
  { ...scene("slime-cost", "The same sidebar of twelve slimes, original and current idle CPU", [{ action: "member-column", collapsed: false }, { action: "idle-cost", seconds: 12, revision: "a47aa935" }, { action: "idle-cost", seconds: 12 }], { sidebarMany: true, rooms: fixture.rooms.slice(0, 1) }), motion: true },
];
