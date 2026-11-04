import { check, click, member, room, scene, stableClick, type, wait } from "./steps.mjs";

const card = '[data-mcp-proposal="mcp-sample"]';
const open = [member(1), wait(card)];
const tested = [...open, click(`${card} [data-mcp-operation="test"]`), wait(`${card}[data-card-state="tested"]`)];
export default [
  scene("mcp-proposal-edit", "The owner edits public MCP configuration in the conversation", [...open, type(`${card} [data-mcp-field="name"]`, "Sample MCP"), stableClick(`${card} [data-mcp-operation="edit"]`, [wait(`${card}[data-mcp-revision="2"]`)]), check("mcp-proposal-edit")], { mcpProposal: "http" }),
  scene("mcp-proposal-tested", "A real test action shows read/write groups before enabling", [...tested, check("mcp-proposal-tested")], { mcpProposal: "http" }),
  scene("mcp-proposal-enabled", "Confirming the tested revision enables the server and continues the work", [...tested, click(`${card} [data-mcp-operation="enable"]`), wait(`${card}[data-card-state="enabled"]`), check("mcp-proposal-enabled")], { mcpProposal: "http" }),
  scene("mcp-proposal-stdio", "Testing a local server requires the shared local command choices", [...open, click(`${card} [data-mcp-operation="test"]`), wait(`${card}[data-card-state="approval"]`), check("mcp-proposal-stdio")], { mcpProposal: "stdio" }),
  scene("mcp-proposal-cancelled", "Cancelling leaves a settled card without an enabled connection", [...open, click(`${card} [data-mcp-operation="cancel"]`), wait(`${card}[data-card-state="cancelled"]`), check("mcp-proposal-cancelled")], { mcpProposal: "http" }),
  scene("mcp-proposal-room", "Room background work renders the same editable connection card", [room(1), wait(card), check("mcp-proposal-room")], { mcpProposal: "room" }),
  scene("mcp-proposal-secret", "MCP secret values stay in the existing masked secret card", [...open, wait('[data-secret-card="card-mcp-key"]'), type('[data-secret-card="card-mcp-key"] input[type="password"]', "sample-owner-key"), check("mcp-proposal-secret")], { mcpProposal: "secret" }),
];
