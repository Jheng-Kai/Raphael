// Mermaid is isolated from startup and runs without directives, links, HTML or external resources.
import mermaid from "mermaid";

export function diagramSourceAllowed(source: string): boolean {
  return source.length <= 25000 && !/(?:%%\{|^\s*---|^\s*(?:click|style|classDef|linkStyle)\s|[a-z][\w+.-]*:\/\/|\/\/|data:|file:|\b(?:img|image|icon)\s*:|(?:href|src)\s*=|url\s*\(|@import|<\/?[a-z])/im.test(source);
}

let serial = 0;
export async function renderDiagram(source: string, colors: Record<string, string>): Promise<string | null> {
  if (!diagramSourceAllowed(source)) return null;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, theme: "base", suppressErrorRendering: true,
    maxTextSize: 25000, maxEdges: 500, deterministicIds: false,
    secure: ["securityLevel", "htmlLabels", "theme", "themeVariables", "maxTextSize", "maxEdges", "startOnLoad"],
    flowchart: { htmlLabels: false },
    themeVariables: { background: colors.panel, primaryColor: colors.surface, primaryTextColor: colors.text, primaryBorderColor: colors.edge,
      secondaryColor: colors.surface, secondaryTextColor: colors.text, secondaryBorderColor: colors.edge,
      tertiaryColor: colors.panel, tertiaryTextColor: colors.text, tertiaryBorderColor: colors.edge,
      lineColor: colors.muted, textColor: colors.text, mainBkg: colors.surface, nodeBorder: colors.edge,
      clusterBkg: colors.panel, clusterBorder: colors.edge, edgeLabelBackground: colors.panel,
      actorBkg: colors.surface, actorBorder: colors.edge, actorTextColor: colors.text, actorLineColor: colors.muted,
      signalColor: colors.text, signalTextColor: colors.text, labelBoxBkgColor: colors.panel, labelBoxBorderColor: colors.edge,
      labelTextColor: colors.text, loopTextColor: colors.text, noteBkgColor: colors.surface, noteTextColor: colors.text, noteBorderColor: colors.edge,
      activationBkgColor: colors.surface, activationBorderColor: colors.edge, sequenceNumberColor: colors.panel,
      attributeBackgroundColorOdd: colors.panel, attributeBackgroundColorEven: colors.surface,
      rowOdd: colors.panel, rowEven: colors.surface,
      relationColor: colors.muted, relationLabelBackground: colors.panel, relationLabelColor: colors.text,
      archEdgeColor: colors.muted, archEdgeArrowColor: colors.muted, archGroupBorderColor: colors.edge,
      archGroupBackground: colors.panel, archServiceBackground: colors.surface, archServiceBorderColor: colors.edge,
      fontFamily: 'Inter, "Microsoft JhengHei UI", sans-serif' } });
  const staging = document.createElement("div"); staging.className = "mermaid-staging";
  document.body.append(staging);
  try {
    if (!await mermaid.parse(source, { suppressErrors: true })) return null;
    const { svg } = await mermaid.render(`reply-diagram-${++serial}`, source, staging);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror")) return null;
    doc.documentElement.classList.add("diagram-canvas");
    doc.documentElement.removeAttribute("style");
    doc.documentElement.removeAttribute("height");
    const intrinsicWidth = Number(doc.documentElement.getAttribute("viewBox")?.trim().split(/[ ,]+/)[2]);
    doc.documentElement.setAttribute("width", Number.isFinite(intrinsicWidth) && intrinsicWidth > 0 ? String(intrinsicWidth) : "100%");
    doc.querySelectorAll("script,foreignObject,image,iframe,object,embed,a").forEach(node => node.remove());
    // ER's unified renderer inherits a border-colored label; keep SVG edge labels readable.
    for (const node of doc.querySelectorAll('.edgeLabel text, .edgeLabel tspan, .edgeLabel rect')) {
      const paint = node.tagName === 'rect' ? colors.panel : colors.text;
      node.setAttribute('style', `${node.getAttribute('style') ?? ''};fill:${paint}`);
    }
    for (const node of doc.querySelectorAll('marker circle[fill="white"]')) node.setAttribute('fill', colors.panel);
    // Built-in architecture icons carry a fixed blue/white palette; adapt their local paths to the app palette.
    const iconPaint = (paint: string, property: string): string => /^(?:none|currentColor|inherit|url\()/i.test(paint.trim()) ? paint
      : property === 'stroke' || /^(?:#fff(?:fff)?|white)$/i.test(paint.trim()) ? colors.text : colors.surface;
    for (const node of doc.querySelectorAll('svg svg [fill], svg svg [stroke], svg svg [style]')) {
      for (const attr of ['fill', 'stroke']) {
        const paint = node.getAttribute(attr);
        if (paint) node.setAttribute(attr, iconPaint(paint, attr));
      }
      const style = node.getAttribute('style');
      if (style) node.setAttribute('style', style.replace(/\b(fill|stroke)\s*:\s*([^;]+)/gi, (_all, property: string, paint: string) => `${property}:${iconPaint(paint, property)}`));
    }
    for (const node of doc.querySelectorAll("*")) for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /href$/i.test(attr.name) || /(?:https?:|data:|file:|@import)/i.test(attr.value)) node.removeAttribute(attr.name);
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch { return null; }
  finally { staging.remove(); }
}
