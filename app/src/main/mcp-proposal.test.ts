import { describe, expect, it } from "vitest";
import { mcpProposalHTML } from "./mcp-proposal";
import { setLocale } from "./i18n";
import type { ConnectionProposal } from "./types";

const proposal = (extra: Partial<ConnectionProposal> = {}): ConnectionProposal => ({
  id: "sample", state: "draft", revision: 1, error: null, first_local: true, groups: [],
  fields: { name: "Sample", transport: "http", command: "", args: [], url: "https://example.invalid/mcp", env: [], headers: ["Authorization"] }, ...extra,
});

describe("conversation MCP proposals", () => {
  it("shows editable public fields and real actions without a raw JSON editor or secret values", () => {
    setLocale("zh-TW");
    const html = mcpProposalHTML(proposal());
    expect(html).toContain('data-mcp-field="name"');
    expect(html).toContain('data-mcp-field="url"');
    expect(html).toContain('data-mcp-operation="test"');
    expect(html).not.toContain('data-mcp-operation="enable"');
    expect(html).not.toContain("<pre");
    expect(html).not.toContain('type="password"');
    expect(html).toContain("Authorization");
  });

  it("shows both tool groups and enables only the tested revision", () => {
    const html = mcpProposalHTML(proposal({ state: "tested", groups: [{ kind: "read", tools: ["read_sample"] }, { kind: "write", tools: ["save_sample"] }] }));
    expect(html).toContain("read_sample");
    expect(html).toContain("save_sample");
    expect(html).toContain('data-mcp-operation="enable"');
    expect(html).toContain('data-mcp-revision="1"');
  });

  it("uses the shared local command decisions and escapes external tool names", () => {
    const html = mcpProposalHTML(proposal({ state: "approval", fields: { ...proposal().fields, transport: "stdio", command: "sample.exe" } }));
    for (const choice of ["always", "once", "never", "deny"]) expect(html).toContain(`data-mcp-choice="${choice}"`);
    expect(mcpProposalHTML(proposal({ state: "tested", groups: [{ kind: "write", tools: ['<img onerror="x">'] }] }))).not.toContain('<img onerror="x">');
  });
});
