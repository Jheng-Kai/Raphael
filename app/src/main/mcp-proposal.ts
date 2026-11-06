import { cardDisclosureHTML, cardFailure, cardHTML } from "./card";
import { connectionProposal } from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { connectionMarkHTML } from "./secret-card";
import type { AgentTurn, ConnectionProposal } from "./types";
import { btn, esc } from "./ui";

const stateKeys = { draft: "mcp.draft", approval: "cards.waiting", testing: "mcp.testing", tested: "mcp.tested", enabled: "mcp.enabled", cancelled: "mcp.cancelled" } as const;

export function mcpProposalHTML(card: ConnectionProposal, configure?: string): string {
  const active = !["enabled", "cancelled", "testing", "approval"].includes(card.state);
  const attr = ` data-act="mcp-proposal"`;
  const action = (operation: string, text: string, primary = false, choice = ""): string =>
    btn(esc(text), `sm${primary ? " pri" : ""}`, `${attr} data-mcp-operation="${operation}"${choice ? ` data-mcp-choice="${choice}"` : ""}`);
  const field = (name: keyof ConnectionProposal["fields"], label: string, value: string): string =>
    `<label class="mcp-field"><span>${esc(label)}</span><span class="field"><input data-mcp-field="${name}" value="${esc(value)}"${active ? "" : " readonly"}></span></label>`;
  const form = field("name", t("conn.form.name"), card.fields.name) +
    (card.fields.transport === "http" ? field("url", t("conn.form.url"), card.fields.url) :
      field("command", t("conn.form.command"), card.fields.command) + `<label class="mcp-field"><span>${esc(t("mcp.argLines"))}</span><textarea class="field" data-mcp-field="args" rows="${Math.max(1, card.fields.args.length)}"${active ? "" : " readonly"}>${esc(card.fields.args.join("\n"))}</textarea></label>`) +
    field(card.fields.transport === "http" ? "headers" : "env", t("mcp.secretNames"), (card.fields.transport === "http" ? card.fields.headers : card.fields.env).join(", "));
  let actions = "";
  if (active) actions = (card.state === "tested" ? action("enable", t("mcp.enable"), true) : action("test", t("mcp.test"), true)) + action("edit", t("mem.save")) + action("cancel", t("conn.cancel"));
  if (card.state === "approval") actions = action("test", t(card.first_local ? "perm.once" : "local.allow"), true, "once") +
    (card.first_local ? action("test", t("perm.always"), false, "always") : "") +
    action("test", t(card.first_local ? "local.deny" : "local.skip"), false, "deny") +
    (card.first_local ? action("test", t("local.never"), false, "never") : "");
  if (configure) actions = btn(esc(t("mcp.add")), "sm pri", configure);
  const groups = card.groups.map(group => `<section class="mcp-tools"><h4>${esc(t(group.kind === "read" ? "conn.group.read" : "conn.group.write"))}</h4><ul>${group.tools.map(name => `<li>${esc(name)}</li>`).join("")}</ul></section>`).join("");
  const settled = card.state === "enabled" || card.state === "cancelled";
  const content = `<div class="card-well mcp-fields" data-mcp-transport="${card.fields.transport}">${form}</div>${groups}`;
  return cardHTML({ title: card.fields.name, mark: connectionMarkHTML(card.fields.name), status: card.error ? "failed" : card.state === "enabled" ? "done" : card.state === "tested" || card.state === "cancelled" ? "ready" : "waiting",
    statusText: card.error ? t("cards.failed") : t(stateKeys[card.state]), body: card.error ? t("cards.retained") : card.state === "approval" ? t("mcp.approval") : settled ? undefined : t("cards.mcpReview"),
    content: (settled ? cardDisclosureHTML(card.id, content) : content) + `<div class="mcp-error" role="alert"${card.error ? "" : " hidden"}>${card.error ? esc(t(card.error === "missing_secret" ? "mcp.missingSecret" : card.error === "local_disabled" ? "mcp.localDisabled" : "mcp.failed")) : ""}</div>`,
    actions, cls: "mcp-proposal", attrs: ` data-mcp-proposal="${esc(card.id)}" data-mcp-revision="${card.revision}" data-mcp-fields="${esc(JSON.stringify(card.fields))}" data-card-state="${card.state}"`,
  });
}

export const mcpProposalsHTML = (turn: AgentTurn): string => (turn.connection_proposals ?? []).map(card => mcpProposalHTML(card)).join("");

export function mountMcpProposals(thread: HTMLElement, changed: () => void): void {
  const busy = new Set<string>();
  thread.addEventListener("input", event => {
    const field = event.target;
    if (field instanceof HTMLTextAreaElement && field.matches("[data-mcp-field]")) {
      field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`;
    }
  });
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-mcp-operation]");
    const card = button?.closest<HTMLElement>("[data-mcp-proposal]");
    const id = card?.dataset.mcpProposal;
    if (!button || !card || !id || busy.has(id)) return;
    const fields = Object.fromEntries([...card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-mcp-field]")].map(field => [field.dataset.mcpField!, field.value]));
    const operation = button.dataset.mcpOperation!;
    const names = (text: string | undefined): string[] => (text ?? "").split(",").map(name => name.trim()).filter(Boolean);
    const publicFields = { name: fields.name, transport: card.querySelector<HTMLElement>("[data-mcp-transport]")!.dataset.mcpTransport,
      command: fields.command ?? "", args: fields.args ? fields.args.split("\n") : [], url: fields.url ?? "", env: names(fields.env), headers: names(fields.headers) };
    busy.add(id);
    card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = true; });
    void (async () => {
      let revision = Number(card.dataset.mcpRevision);
      const original = JSON.parse(card.dataset.mcpFields!) as Record<string, unknown>;
      const edited = Object.entries(publicFields).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key]));
      if (operation !== "cancel" && (operation === "edit" || edited) && card.dataset.cardState !== "approval") {
        const result = await connectionProposal({ id, revision, operation: "edit", fields: publicFields });
        revision = result.proposal.revision;
      }
      if (operation !== "edit" && !(edited && operation === "enable")) await connectionProposal({ id, revision, operation, ...(button.dataset.mcpChoice ? { local_choice: button.dataset.mcpChoice } : {}) });
      changed();
    })().catch(error => {
      const notice = card.querySelector<HTMLElement>('[role="alert"]')!;
      notice.textContent = describeError(error); notice.hidden = false;
      card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = false; });
      cardFailure(card, () => button.click());
    }).finally(() => busy.delete(id));
  });
}
