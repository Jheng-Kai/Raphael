import { scene, wait, check, click, scroll, member, room, hover, focus, key } from "./steps.mjs";
const table = '.rich-block.message-table';
const diagram = '.message-diagram[data-diagram-state="rendered"]';
// R-UI-172: the drawn chart under the card's header opens the larger view, which zooms and drags.
const chart = `${diagram} > .diagram-view`, larger = '.diagram-dialog .diagram-stage .diagram-pan > svg';
const zoomed = [{ action: "wheel", selector: ".diagram-dialog .diagram-stage", deltaY: -300 }, { action: "wheel", selector: ".diagram-dialog .diagram-stage", deltaY: -300 },
  { action: "pointer-drag", selector: ".diagram-dialog .diagram-stage", dx: -140, dy: -50 },
  { action: "pointer-drag", selector: ".diagram-dialog .diagram-stage", dx: 60, dy: 30, button: "right", expectMenuClosed: true }];
const ready = [wait(table), scroll('.message-code:not(.message-diagram)'), wait('.message-code[data-highlighted="true"]'), scroll('.message-diagram'), wait(diagram), check("rich-content"), check("reply-measure")];
export default [
  scene("team-file-reply", "A file of the team folder is a real button in the reply", [wait('[data-act="team-file-open"]')], { richReply: "teamFile" }),
  scene("rich-chief", "Chief reply has ordered rich cards outside text bubbles", [...ready, scroll(table)], { richReply: true }),
  scene("rich-member", "Member reply shares the same typed rich content", [member(1), ...ready, scroll(table)], { richReply: true }),
  scene("rich-room", "Group reply shares the same rich cards", [room(1), ...ready, scroll(table)], { richReply: true }),
  scene("rich-code", "Code keeps its language header and local horizontal scrolling", [...ready, scroll('.message-code:not(.message-diagram)'), check("rich-code")], { richReply: true }),
  scene("rich-diagram", "Mermaid draws SVG without HTML or active links", [...ready, scroll(diagram), check("rich-diagram")], { richReply: true }),
  scene("rich-source", "Diagram source toggles inside its card", [...ready, click(`${diagram} [data-rich-act="view-source"]`), wait(`${diagram} pre:not([hidden])`), scroll(`${diagram} pre`), check("rich-source")], { richReply: true }),
  scene("rich-expand", "Diagram uses the shared large dialog and close controls", [...ready, click(`${diagram} [data-rich-act="expand"]`), wait('.rich-view-dialog svg'), check("rich-expand")], { richReply: true }),
  scene("rich-diagram-hover", "The pointer over a drawn diagram's chart shows it opens: a pointer and one calm grey step over the chart", [...ready, scroll(diagram), hover(chart), check("rich-diagram-hover")], { richReply: true }),
  scene("rich-diagram-press", "Pressing the chart opens the larger view fitted, with − + reset beside its × and one quiet line of how to use it", [...ready, scroll(diagram), click(chart), wait(larger), check("rich-diagram-view")], { richReply: true }),
  scene("rich-diagram-key", "Enter on the focused chart opens the same larger view", [...ready, scroll(diagram), focus(chart), key("Enter"), wait(larger), check("rich-diagram-view")], { richReply: true }),
  scene("rich-diagram-zoomed", "The larger diagram zooms with the wheel and moves when dragged with the left or the right button, with no menu", [...ready, scroll(diagram), click(chart), wait(larger), ...zoomed, check("rich-diagram-zoomed")], { richReply: true }),
  scene("rich-image", "Remote image is a consent card without an image request", [...ready, scroll('.message-image'), check("rich-image")], { richReply: true }),
  scene("rich-image-loaded", "Explicit image consent loads without referrer and can expand", [...ready, click('[data-rich-act="load-image"]'), wait('.message-image img'), check("rich-image-loaded"), click('[data-rich-act="expand-image"]'), wait('.rich-view-dialog img')], { richReply: true }),
  scene("rich-table-example", "Owner's three-column example wraps Chinese text and keeps inline links", [wait(table), scroll(table), check("rich-table-example")], { richReply: "table" }),
  scene("rich-invalid", "Invalid Mermaid keeps source with a quiet note", [wait('.message-diagram[data-diagram-state="source"]'), check("rich-fallback")], { richReply: "invalid" }),
  scene("rich-streaming", "Unclosed Mermaid stays readable source until finished", [wait('.message-diagram[data-complete="false"]'), check("rich-fallback")], { richReply: "streaming" }),
  scene("rich-sequence", "Sequence diagram uses the same token-derived theme", [wait(diagram), check("rich-diagram")], { richReply: "sequence" }),
  scene("rich-line-breaks", "A flowchart whose labels break a line with <br/> is drawn, each label on two lines", [wait(diagram), check("rich-diagram"), check("rich-line-breaks")], { richReply: "breaks" }),
  ...["class", "state", "er", "architecture"].map(type => scene(`rich-${type}`, `${type} Mermaid diagram uses the same strict renderer`, [wait(diagram), check("rich-diagram")], { richReply: type })),
  scene("rich-wide-table", "Wide tables scroll inside their card as a last resort", [wait(table), check("rich-wide-table")], { richReply: "wide" }),
];
