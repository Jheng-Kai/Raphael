// `field-sizing: content` grows a text field with what it holds. WebKit has it only from Safari 26, so on
// macOS 13 to 15 the composer and the editors would stay one line high: there the same fields are sized from
// their content by script. Chromium (WebView2) and Safari 26 do it themselves and this does nothing.

/** The text fields the styles size by their content (`field-sizing: content`). */
export const CONTENT_SIZED = [
  ".cmp-input", ".conversation-card textarea", ".au-pop .mb-ta",
  ".ms-list > .mb-ta.ms-field", ".owner-profile textarea.field:focus",
].join(", ");

/** Sets the field's height to what it holds, within its own min and max heights. */
export function fitToContent(field: HTMLTextAreaElement): void {
  const style = getComputedStyle(field);
  field.style.height = "auto";
  const length = (value: string): number => parseFloat(value) || 0;
  const border = length(style.borderTopWidth) + length(style.borderBottomWidth);
  const padding = length(style.paddingTop) + length(style.paddingBottom);
  const height = style.boxSizing === "border-box" ? field.scrollHeight + border : field.scrollHeight - padding;
  field.style.height = `${Math.max(0, height)}px`;
}

/**
 * Where the webview cannot size fields by their content, sizes them by script: as the owner types, when one
 * takes the focus, and when the page writes a value into one (a draft put back, a sent message cleared).
 */
export function sizeFieldsByScript(doc: Document = document, supported = CSS.supports("field-sizing", "content")): boolean {
  if (supported) return false;
  const fit = (target: EventTarget | null): void => {
    if (target instanceof HTMLTextAreaElement && target.matches(CONTENT_SIZED)) fitToContent(target);
  };
  doc.addEventListener("input", event => fit(event.target), true);
  doc.addEventListener("focusin", event => fit(event.target), true);
  const view = doc.defaultView;
  if (view) {
    const prototype = view.HTMLTextAreaElement.prototype;
    const value = Object.getOwnPropertyDescriptor(prototype, "value");
    if (value?.set && value.get) {
      Object.defineProperty(prototype, "value", {
        ...value,
        set(this: HTMLTextAreaElement, text: string) {
          value.set!.call(this, text);
          if (this.isConnected && this.matches(CONTENT_SIZED)) queueMicrotask(() => fitToContent(this));
        },
      });
    }
  }
  doc.documentElement.dataset.fieldSizing = "script";
  return true;
}
