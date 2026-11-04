/** Plugin sets share the existing skill dialog, rows and MCP setup cards. */
import { t } from "./i18n";
import { mcpProposalHTML } from "./mcp-proposal";
import { skillSourceLabel } from "./skill-source";
import type { ConnectionProposal } from "./types";
import { actionRow, btn, esc, ico } from "./ui";

export interface SkillSet {
  id: number;
  name: string;
  version: string;
  description: string;
  source: string;
  skill_count: number;
  command_count: number;
  source_changed?: boolean | null;
  marketplace?: string;
  mcp_servers: ConnectionProposal["fields"][];
}

export interface SkillMarketplace {
  repo: string;
  name: string;
  plugins: { name: string; description: string; version: string; installable: boolean; reason?: string }[];
}

export const setCount = (set: Pick<SkillSet, "skill_count" | "command_count">): string => t("skills.setCount", { p0: set.skill_count, p1: set.command_count });
export const setSource = (set: SkillSet): string => set.marketplace || skillSourceLabel(set.source, set.name);
const reasonLabel = (reason: string): string => /only (?:HTTPS )?GitHub|source type is not supported/.test(reason) ? t("skills.githubOnly") : reason;

export function skillSetHeading(set: SkillSet): string {
  return `<div class="data-heading cs-set-heading" data-skill-set="${set.id}">${btn(`<span class="cs-library-icon">${ico("book")}</span><span class="tx"><strong>${esc(set.name)} · ${esc(set.version)}</strong><span class="ds">${esc(setCount(set))}</span></span>`, "cs-open", ` data-conn="set-open" data-id="${set.id}" aria-haspopup="dialog"`)}${set.source_changed ? btn(ico("refresh") + esc(t("skills.reimport")), "sm gr", ` data-conn="set-update" data-id="${set.id}"`) : ""}${btn(ico("right"), "icon", ` data-conn="set-open" data-id="${set.id}" aria-label="${esc(set.name)}"`)}</div>`;
}

export function skillSetDialogHTML(set: SkillSet, close: string, notice: string, busy: boolean): string {
  const off = busy ? " disabled" : "";
  return `<div class="cs-dlg-head"><span class="cs-library-icon">${ico("book")}</span><span class="sp"></span>${close}</div><h2 class="cs-dlg-name" id="cs-dlg-title">${esc(set.name)} · ${esc(set.version)}</h2>` +
    `<p class="cs-desc">${esc(setCount(set))} · ${esc(setSource(set))}</p><p>${esc(set.description)}</p><p class="cs-desc">${esc(t("skills.unusedParts"))}</p>` +
    set.mcp_servers.map((fields, index) => `<div data-set-mcp="${index}">${mcpProposalHTML({ id: `set-${set.id}-${index}`, fields, state: "draft", revision: 0, groups: [], error: null, first_local: false }, ` data-conn="set-mcp" data-id="${set.id}" data-server="${index}"${off}`)}</div>`).join("") + notice +
    actionRow({ cls: "cs-acts", sticky: true, destructive: { label: esc(t("skills.removeSet")), attrs: ` data-conn="set-delete" data-id="${set.id}"${off}` }, primary: { label: esc(t("skills.reimport")), attrs: ` data-conn="set-update" data-id="${set.id}"${off}` } });
}

export function marketplacesHTML(markets: SkillMarketplace[], busy: boolean): string {
  const off = busy ? " disabled" : "";
  return `<section class="cs-sec"><h3>${esc(t("skills.marketplaces"))}</h3><div class="row"><label class="sp"><input class="field" id="skill-marketplace" aria-label="${esc(t("skills.marketplaceAddress"))}" placeholder="${esc(t("skills.marketplaceHint"))}" spellcheck="false"${off}></label>${btn(ico("plus") + esc(t("skills.addMarketplace")), "sm", ` data-conn="marketplace-add"${off}`)}</div></section>` +
    markets.map((market, index) => `<section class="cs-sec" data-skill-marketplace="${esc(market.repo)}"><div class="data-heading"><h3>${esc(market.name)}</h3>${btn(ico("refresh") + esc(t("skills.checkUpdates")), "sm gr", ` data-conn="marketplace-refresh" data-market="${index}"${off}`)}</div><p class="cs-desc">${esc(market.repo)}</p><div class="cs-list">` + market.plugins.map((plugin, at) =>
      `<div class="cs-item cs-source" data-market-plugin="${esc(plugin.name)}"><div class="cs-open"><span class="tx"><span class="nm">${esc(plugin.name)}${plugin.version ? ` · ${esc(plugin.version)}` : ""}</span><span class="ds">${esc(plugin.description)}</span>${plugin.installable ? "" : `<span class="ds">${esc(t("skills.notInstallable"))} · ${esc(reasonLabel(plugin.reason ?? ""))}</span>`}</span></div>${btn(ico("download") + esc(t("skills.installSet")), "sm gr", ` data-conn="marketplace-install" data-market="${index}" data-plugin="${at}"${!plugin.installable || busy ? " disabled" : ""}`)}</div>`).join("") + `</div></section>`).join("");
}
