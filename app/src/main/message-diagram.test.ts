// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ initialize: vi.fn(), parse: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mock }));
import { diagramSourceAllowed, renderDiagram } from "./message-diagram";

test("Mermaid refuses configuration, click handlers, HTML and network resources before parsing", async () => {
  for (const source of ['%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B', 'flowchart LR\nclick A "https://example.com"', 'flowchart LR\nA[<img src=x>]', 'flowchart LR\nstyle A fill:url(https://example.com)', '---\nconfig:\n theme: dark', 'flowchart LR\nA[https://example.com]', 'flowchart LR\nA@{ img: "/private" }', 'flowchart LR\nA@{ img: "//evil.example/a" }', 'flowchart LR\nA@{ img: "ftp://evil.example/a" }']) {
    expect(diagramSourceAllowed(source)).toBe(false);
    expect(await renderDiagram(source, {})).toBeNull();
  }
  expect(mock.parse).not.toHaveBeenCalled();
});

test("invalid Mermaid keeps source; strict token-themed rendering strips all active SVG content", async () => {
  mock.parse.mockResolvedValueOnce(false);
  expect(await renderDiagram("invalid diagram", {})).toBeNull();
  mock.parse.mockResolvedValue(true);
  mock.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 420"><script>bad()</script><image href="https://example.com"/><foreignObject/><a href="https://example.com"/><text onclick="bad()">Safe</text><g class="edgeLabel"><rect/><text>contains</text></g><marker><circle fill="white"/></marker><svg><rect style="fill: #087ebf; stroke-width: 0px;"/><path fill="#0078D4"/><path fill="#fff"/></svg></svg>' });
  const colors = { panel: "#101010", surface: "#202020", text: "#eeeeee", muted: "#aaaaaa", edge: "#444444" };
  const svg = await renderDiagram('flowchart LR\nA-->B', colors);
  expect(svg).toContain("Safe");
  expect(svg).toContain('width="240"');
  expect(svg).not.toMatch(/script|foreignObject|image|onclick|href/);
  expect(svg).not.toContain('#0078D4');
  expect(svg).not.toContain('#087ebf');
  expect(svg).toContain('fill="#202020"');
  expect(svg).toContain('fill="#eeeeee"');
  expect(svg).toContain('style=";fill:#eeeeee"');
  expect(svg).toContain('style=";fill:#101010"');
  expect(svg).toContain('circle fill="#101010"');
  expect(mock.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ securityLevel: "strict", htmlLabels: false, startOnLoad: false, themeVariables: expect.objectContaining({ primaryColor: colors.surface, primaryTextColor: colors.text, attributeBackgroundColorOdd: colors.panel, attributeBackgroundColorEven: colors.surface, rowOdd: colors.panel, rowEven: colors.surface }) }));
  expect(document.querySelector('.mermaid-staging')).toBeNull();
});
