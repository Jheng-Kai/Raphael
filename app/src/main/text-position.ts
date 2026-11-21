const anchors = new WeakMap<HTMLInputElement | HTMLTextAreaElement, { prefix: string; rect: () => DOMRect }>();

/** A completion stays at the token's start while its query changes. Scroll and resize can still move it. */
export function completionAnchor(input: HTMLInputElement | HTMLTextAreaElement, position: number): () => DOMRect {
  const prefix = input.value.slice(0, position + 1), last = anchors.get(input);
  if (last?.prefix === prefix) return last.rect;
  const rect = () => textPositionRect(input, position, input.closest(".cmp-field") ?? document.body);
  anchors.set(input, { prefix, rect });
  return rect;
}

/** Measure a text position using the field's font, wrapping, padding and scroll offset. */
export function textPositionRect(input: HTMLTextAreaElement | HTMLInputElement, position: number, parent: Element = document.body): DOMRect {
  const style = getComputedStyle(input), bounds = input.getBoundingClientRect();
  if (position === 0 && style.direction === "ltr" && (style.textAlign === "start" || style.textAlign === "left") && style.textIndent === "0px") {
    return new DOMRect(bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - input.scrollLeft,
      bounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) - input.scrollTop, 0,
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20);
  }
  const mirror = document.createElement("div"), marker = document.createElement("span");
  const properties = ["boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textTransform", "textAlign", "direction", "tabSize", "wordBreak", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] as const;
  for (const property of properties) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: "fixed", left: "0", top: "0", contain: "strict", visibility: "hidden", pointerEvents: "none", borderStyle: "solid", width: style.width && style.width !== "auto" ? style.width : `${bounds.width}px`, height: style.height && style.height !== "auto" ? style.height : `${bounds.height}px`, overflow: "hidden", whiteSpace: input instanceof HTMLTextAreaElement && input.wrap !== "off" ? "pre-wrap" : "pre", overflowWrap: style.overflowWrap || "break-word" });
  // Reserve a textarea's vertical scrollbar width so soft wraps occur at the same character.
  if (input.clientWidth && input.offsetWidth - input.clientWidth > parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 1) mirror.style.overflowY = "scroll";
  const at = Math.max(0, Math.min(position, input.value.length));
  mirror.textContent = input.value.slice(0, at);
  marker.textContent = input.value.slice(at) || ".";
  mirror.append(marker); parent.append(mirror);
  try {
    const origin = mirror.getBoundingClientRect();
    const text = marker.getClientRects()[0] ?? marker.getBoundingClientRect();
    const height = parseFloat(style.lineHeight) || text.height || parseFloat(style.fontSize) * 1.2 || 20;
    return new DOMRect(bounds.left + text.left - origin.left - input.scrollLeft, bounds.top + text.top - origin.top - input.scrollTop, 0, height);
  } finally { mirror.remove(); }
}
