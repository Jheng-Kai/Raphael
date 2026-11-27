// What floats over a selection in the composer: the block's kind (a menu: text, headings, lists, a quote, a toggle, code...), the
// marks (bold, italic, underline, strike, code, highlight), an inline equation, and the link, whose editor takes the bar's place
// (Mod+K, or its button). It is in the app's flat design language: icons from the app's set at 16 px, the menu of `ui.ts`, tokens
// for sizes and colours. It stands above the words (below them when there is no room above), never over them, and it
//  - is closed by Escape, by the words leaving the selection (typing replaces it), and by the editor losing the focus elsewhere,
//  - keeps the focus in the editor (a press on a button changes the words, not the caret), and is reached from the keyboard with
//    Alt+F10 (arrows move along it, Escape goes back to the words),
//  - positions itself with Floating UI, which is also what TipTap's bubble menu does; TipTap's is not used because it keeps the
//    bar open by a flag that a press sets and only a blur clears, and it cannot stay open while a menu or the link editor holds the focus.
import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from "@floating-ui/dom";
import { type Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { KEYS_ATTRIBUTE } from "./focus-keys";
import { shortcutText } from "./keys";
import { t } from "./i18n";
import { messageUrl } from "./markdown-text";
import type { MessageKey } from "./i18n/zh-TW";
import { type Choice, closeMenu, ico, type IconName, iconButton, openMenu } from "./ui";

/** A message without slots, whichever of the plain ones it is. */
const word = t as (key: MessageKey) => string;
type Keys = readonly string[];
interface Format { id: string; icon: IconName; label: MessageKey; keys: Keys; mark: string; run(editor: Editor): void }

// Each format: its words and its keys are written out here, one place for the bar's button, its tooltip and its menu.
const FORMATS: readonly Format[] = [
  { id: "bold", icon: "bold", label: "composer.fmt.bold", keys: ["Primary", "B"], mark: "bold", run: e => e.chain().focus().toggleBold().run() },
  { id: "italic", icon: "italic", label: "composer.fmt.italic", keys: ["Primary", "I"], mark: "italic", run: e => e.chain().focus().toggleItalic().run() },
  { id: "underline", icon: "underline", label: "composer.fmt.underline", keys: ["Primary", "U"], mark: "underline", run: e => e.chain().focus().toggleUnderline().run() },
  { id: "strike", icon: "strike", label: "composer.fmt.strike", keys: ["Primary", "Shift", "S"], mark: "strike", run: e => e.chain().focus().toggleStrike().run() },
  { id: "code", icon: "codeInline", label: "chat.code", keys: ["Primary", "E"], mark: "code", run: e => e.chain().focus().toggleCode().run() },
  { id: "highlight", icon: "highlight", label: "composer.fmt.highlight", keys: ["Primary", "Shift", "H"], mark: "highlight", run: e => e.chain().focus().toggleHighlight().run() },
];

interface Block { value: string; icon: IconName; label: () => string; keys?: Keys; group: "turn" | "insert"; active(editor: Editor): boolean; run(editor: Editor): void }

const heading = (level: 1 | 2 | 3): Block => ({
  value: `h${level}`, icon: `heading${level}`, label: () => t("composer.block.heading", { p0: String(level) }), keys: ["Primary", "Alt", String(level)], group: "turn",
  active: e => e.isActive("heading", { level }), run: e => e.chain().focus().setHeading({ level }).run(),
});
const BLOCKS: readonly Block[] = [
  { value: "paragraph", icon: "paragraph", label: () => t("composer.block.text"), keys: ["Primary", "Alt", "0"], group: "turn",
    active: e => e.isActive("paragraph"), run: e => e.chain().focus().clearNodes().run() },
  heading(1), heading(2), heading(3),
  { value: "bullets", icon: "bullets", label: () => t("composer.block.bullets"), keys: ["Primary", "Shift", "8"], group: "turn",
    active: e => e.isActive("bulletList") && !isTask(e), run: e => e.chain().focus().toggleBulletList().run() },
  { value: "numbers", icon: "numbers", label: () => t("composer.block.numbers"), keys: ["Primary", "Shift", "7"], group: "turn",
    active: e => e.isActive("orderedList"), run: e => e.chain().focus().toggleOrderedList().run() },
  { value: "tasks", icon: "tasks", label: () => t("composer.block.tasks"), keys: ["Primary", "Shift", "9"], group: "turn",
    active: isTask, run: e => e.chain().focus().toggleTask().run() },
  { value: "quote", icon: "quote", label: () => t("chat.quote"), keys: ["Primary", "Shift", "B"], group: "turn",
    active: e => e.isActive("blockquote"), run: e => e.chain().focus().toggleBlockquote().run() },
  { value: "toggle", icon: "right", label: () => t("composer.block.toggle"), group: "turn",
    active: e => e.isActive("summary") || e.isActive("details"), run: e => e.chain().focus().makeToggle().run() },
  { value: "code", icon: "codeBlock", label: () => t("composer.block.code"), keys: ["Primary", "Alt", "C"], group: "turn",
    active: e => e.isActive("codeBlock"), run: e => e.chain().focus().toggleCodeBlock().run() },
  { value: "math", icon: "equation", label: () => t("composer.block.math"), group: "turn",
    active: e => e.isActive("mathBlock"), run: e => e.chain().focus().setNode("mathBlock").run() },
  { value: "rule", icon: "minus", label: () => t("composer.block.rule"), group: "insert", active: () => false, run: e => e.chain().focus().setHorizontalRule().run() },
  { value: "table", icon: "table", label: () => t("chat.table"), group: "insert", active: e => e.isActive("table"),
    run: e => e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() },
];
function isTask(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === "listItem") return $from.node(depth).attrs.checked !== null;
  return false;
}

interface TableOp { value: string; label: () => string; run(editor: Editor): void }
const TABLE_OPS: readonly TableOp[] = [
  { value: "rowAbove", label: () => t("composer.table.rowAbove"), run: e => e.chain().focus().addRowBefore().run() },
  { value: "rowBelow", label: () => t("composer.table.rowBelow"), run: e => e.chain().focus().addRowAfter().run() },
  { value: "colLeft", label: () => t("composer.table.colLeft"), run: e => e.chain().focus().addColumnBefore().run() },
  { value: "colRight", label: () => t("composer.table.colRight"), run: e => e.chain().focus().addColumnAfter().run() },
  { value: "delRow", label: () => t("composer.table.delRow"), run: e => e.chain().focus().deleteRow().run() },
  { value: "delCol", label: () => t("composer.table.delCol"), run: e => e.chain().focus().deleteColumn().run() },
  { value: "delTable", label: () => t("composer.table.delete"), run: e => e.chain().focus().deleteTable().run() },
];

/** The address a link editor's words are: `example.com` is `https://example.com`, and only what a reply would draw as a link is one. */
export function linkAddress(words: string): string | null {
  const raw = words.trim();
  if (!raw || /\s/.test(raw)) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  return messageUrl(full) ? full : null;
}

/** An icon button of the bar: the app's own (ui.ts), one tab stop for the bar as a whole (the arrows move it). */
const button = (icon: IconName, label: string, id: string, extra = "", cls = ""): string =>
  iconButton(icon, label, ` data-bar="${id}" tabindex="-1"${extra}`, `cmp-fmt-btn${cls ? " " + cls : ""}`);
const escape = (words: string): string => words.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface ComposerToolbar {
  /** The extension that holds the bar: it listens to the editor's selection. */
  extension: Extension;
  /** Mod+K: the link editor for the words selected (or the word or link the caret is in). Whether it opened. */
  openLink(): boolean;
  destroy(): void;
}

/** The bar for one composer: `host` is the field's element, whose focus and selection the bar follows. */
export function composerToolbar(host: HTMLElement): ComposerToolbar {
  const bar = document.createElement("div");
  bar.className = "cmp-fmt menu-like";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-orientation", "horizontal");
  bar.hidden = true;
  let editor: Editor | undefined;
  let shown = false, dismissed = false, holding = false, linking = false, stop: (() => void) | undefined, pending = 0, placedFor = "";

  const marks = FORMATS.map(format => {
    const keys = shortcutText([...format.keys]);
    return button(format.icon, `${word(format.label)} ${keys}`, format.id, ` aria-pressed="false"`);
  }).join("");
  const render = (): void => {
    bar.setAttribute("aria-label", t("composer.fmt.toolbar"));
    bar.innerHTML =
      `<div class="cmp-fmt-row" data-row="format">` +
      `<button type="button" class="btn cmp-fmt-block" data-bar="block" aria-haspopup="menu" aria-expanded="false" tabindex="0"><span class="cmp-fmt-kind"></span>${ico("down")}</button>` +
      `<span class="cmp-fmt-sep" role="separator"></span>${marks}` +
      `<span class="cmp-fmt-sep" role="separator"></span>` +
      button("equation", t("composer.fmt.math"), "math") + button("link", `${t("composer.fmt.addLink")} ${shortcutText(["Primary", "K"])}`, "link", ` aria-pressed="false"`) +
      `<span class="cmp-fmt-sep cmp-fmt-table" role="separator"></span>${button("table", t("chat.table"), "table", ` aria-haspopup="menu" aria-expanded="false"`, "cmp-fmt-table")}` +
      `<span class="cmp-fmt-sep cmp-fmt-language" role="separator"></span><input class="cmp-fmt-language" type="text" data-bar="language" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${escape(t("composer.codeLanguage"))}" placeholder="${escape(t("composer.codeLanguage"))}">` +
      `</div>` +
      `<div class="cmp-fmt-row cmp-fmt-link" data-row="link" hidden>` +
      `<input class="cmp-fmt-address" type="text" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${escape(t("composer.fmt.linkAddress"))}" placeholder="https://">` +
      button("check", t("composer.fmt.linkSet"), "apply") + button("unlink", t("composer.fmt.unlink"), "unlink") + button("x", t("common.close"), "close") +
      `</div>`;
    bar.querySelectorAll<HTMLElement>('[data-bar="table"], .cmp-fmt-sep.cmp-fmt-table').forEach(el => { el.hidden = true; });
    bar.querySelectorAll<HTMLElement>(".cmp-fmt-language, .cmp-fmt-sep.cmp-fmt-language").forEach(el => { el.hidden = true; });
  };
  render();
  const address = (): HTMLInputElement => bar.querySelector<HTMLInputElement>(".cmp-fmt-address")!;
  const formatRow = (): HTMLElement => bar.querySelector<HTMLElement>('[data-row="format"]')!;
  const linkRow = (): HTMLElement => bar.querySelector<HTMLElement>('[data-row="link"]')!;

  // ----- what the bar shows of the words under it

  /** The innermost kind of block the selection starts in: a task list inside a quote is a task list. */
  const kindOf = (): Block => {
    const { $from } = editor!.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      const value = node.type.name === "heading" ? `h${Math.min(node.attrs.level, 3)}` : node.type.name === "codeBlock" ? "code" : node.type.name === "mathBlock" ? "math"
        : node.type.name === "summary" || node.type.name === "details" ? "toggle" : node.type.name === "blockquote" ? "quote"
        : node.type.name === "listItem" ? (node.attrs.checked !== null ? "tasks" : $from.node(depth - 1).type.name === "orderedList" ? "numbers" : "bullets") : "";
      const found = value && BLOCKS.find(block => block.value === value);
      if (found) return found;
    }
    return BLOCKS[0]!;
  };
  const sync = (): void => {
    if (!editor || !shown) return;
    const { $from } = editor.state.selection, codeLike = $from.parent.type.spec.code === true;
    bar.querySelector<HTMLElement>(".cmp-fmt-kind")!.textContent = kindOf().label();
    for (const format of FORMATS) {
      const el = bar.querySelector<HTMLButtonElement>(`[data-bar="${format.id}"]`)!;
      el.setAttribute("aria-pressed", String(editor.isActive(format.mark)));
      el.disabled = codeLike;
    }
    const link = bar.querySelector<HTMLButtonElement>('[data-bar="link"]')!;
    link.setAttribute("aria-pressed", String(editor.isActive("link")));
    link.disabled = codeLike;
    bar.querySelector<HTMLButtonElement>('[data-bar="math"]')!.disabled = codeLike || editor.isActive("mathBlock") || editor.state.selection.empty;
    const inTable = editor.isActive("table"), inCode = editor.isActive("codeBlock");
    bar.querySelectorAll<HTMLElement>(".cmp-fmt-table").forEach(el => { el.hidden = !inTable; });
    bar.querySelectorAll<HTMLElement>(".cmp-fmt-language").forEach(el => { el.hidden = !inCode; });
    const language = bar.querySelector<HTMLInputElement>('input[data-bar="language"]')!;
    if (inCode && document.activeElement !== language) language.value = String(editor.getAttributes("codeBlock")["language"] ?? "");
  };

  // ----- where it stands

  /**
   * Where the bar stands against: the selection's own stretch across the field and the whole field's height, so that the bar is over
   * (or, with no room over, under) the field and never over any of the words in it, a line above the selection or a row of a table.
   */
  const reference = (): VirtualElement => ({
    contextElement: host,
    getBoundingClientRect: () => {
      const view = editor!.view, { from, to } = editor!.state.selection, field = host.getBoundingClientRect();
      try {
        const a = view.coordsAtPos(from), b = view.coordsAtPos(to);
        const left = Math.max(field.left, Math.min(a.left, b.left)), right = Math.min(field.right, Math.max(a.right, b.right));
        return new DOMRect(left, field.top, Math.max(right - left, 1), field.height);
      } catch { return field; }
    },
  });
  const place = (): void => {
    if (!shown) return;
    void computePosition(reference(), bar, { strategy: "fixed", placement: "top-start", middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })] }).then(({ x, y }) => {
      if (shown) { bar.style.left = `${Math.round(x)}px`; bar.style.top = `${Math.round(y)}px`; }
    });
  };
  const focusInside = (): boolean => bar.contains(document.activeElement) || !!document.activeElement?.closest("#app-popover, #app-submenu");
  const wanted = (): boolean => {
    if (!editor || editor.isDestroyed || !editor.isEditable || dismissed) return false;
    // The link editor keeps the bar for as long as the focus is in it or in the words, whatever the selection (a caret in a link).
    if (linking) return focusInside() || editor.view.hasFocus();
    const { selection } = editor.state;
    if (selection.empty || editor.view.composing) return false;
    return editor.view.hasFocus() || focusInside() || holding;
  };
  const open = (): void => {
    if (shown) return;
    shown = true;
    document.body.append(bar);
    bar.hidden = false;
    stop = autoUpdate(reference(), bar, place, { animationFrame: false });
  };
  const close = (): void => {
    if (!shown) return;
    shown = false; linking = false; holding = false; placedFor = "";
    stop?.(); stop = undefined;
    bar.hidden = true;
    bar.remove();
    showRow("format");
  };
  const update = (): void => {
    if (wanted()) {
      open(); sync();
      // It moves with the selection, not with what the words under it are made of: a bold press leaves it where it stands.
      const { from, to } = editor!.state.selection, key = `${from}:${to}`;
      if (key !== placedFor) { placedFor = key; place(); }
    } else close();
  };
  const later = (): void => { cancelAnimationFrame(pending); pending = requestAnimationFrame(update); };

  /**
   * The words the link editor is for stay drawn as selected while its field has the focus (the editor, blurred, shows no selection):
   * the page's highlight (CSS Custom Highlight API: no change of the editor's DOM, which would move its selection), where it has one.
   */
  function hold(on: boolean): void {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights, Mark = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!highlights || !Mark) return;
    if (!on || !editor || editor.isDestroyed) { highlights.delete("cmp-held"); return; }
    try {
      const { from, to } = editor.state.selection, a = editor.view.domAtPos(from), b = editor.view.domAtPos(to), range = document.createRange();
      range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
      highlights.set("cmp-held", new Mark(range));
    } catch { /* The words stay as they are. */ }
  }

  function showRow(which: "format" | "link"): void {
    linking = which === "link";
    formatRow().hidden = linking;
    linkRow().hidden = !linking;
    hold(linking);
  }

  // ----- the link editor

  const wordAt = (): { from: number; to: number } | null => {
    const { state } = editor!, { $from } = state.selection, parent = $from.parent;
    if (!parent.inlineContent) return null;
    const text = parent.textBetween(0, parent.content.size, undefined, "￼"), at = $from.parentOffset;
    const word = /[\p{L}\p{N}_]/u;
    let start = at, end = at;
    while (start > 0 && word.test(text[start - 1]!)) start--;
    while (end < text.length && word.test(text[end]!)) end++;
    return end > start ? { from: $from.start() + start, to: $from.start() + end } : null;
  };
  const openLink = (): boolean => {
    if (!editor || !editor.isEditable) return false;
    const { state } = editor, { selection } = state;
    if (selection.$from.parent.type.spec.code) return true;
    if (selection.empty && !editor.isActive("link")) {
      const word = wordAt();
      if (!word) return true;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, word.from, word.to)));
    }
    dismissed = false;
    open();
    sync();
    showRow("link");
    const href = String(editor.getAttributes("link")["href"] ?? "");
    address().value = href;
    address().removeAttribute("aria-invalid");
    linkRow().querySelector<HTMLElement>('[data-bar="unlink"]')!.hidden = !href;
    place();
    address().focus();
    address().select();
    return true;
  };
  const backToWords = (): void => { showRow("format"); editor?.view.focus(); later(); };
  const applyLink = (): void => {
    const href = linkAddress(address().value);
    if (!href) { address().setAttribute("aria-invalid", "true"); return; }
    editor!.chain().focus().extendMarkRange("link").setLink({ href }).run();
    backToWords();
  };

  // ----- the controls

  const choices = (): Choice[] => BLOCKS.map(block => ({
    value: block.value, label: block.label(), lead: ico(block.icon), trail: block.keys ? shortcutText([...block.keys]) : undefined,
    group: block.group === "turn" ? t("composer.block.turn") : t("composer.block.insert"),
  }));
  const current = (): string => kindOf().value;
  /** The focus goes back to the words before a choice is made on them: ProseMirror then puts its selection in the page, and reads none from it. */
  const back = (): void => { editor!.view.focus(); };
  const chooseBlock = (anchor: HTMLElement): void => {
    openMenu(anchor, choices(), current(), value => { back(); BLOCKS.find(block => block.value === value)?.run(editor!); later(); },
      undefined, [], { selectionIndicator: true });
  };
  const chooseTable = (anchor: HTMLElement): void => {
    openMenu(anchor, TABLE_OPS.map(op => ({ value: op.value, label: op.label() })), "", value => { back(); TABLE_OPS.find(op => op.value === value)?.run(editor!); later(); },
      undefined, [], { selectionIndicator: false });
  };

  // A press on a control changes the words and leaves the caret where it is (the editor keeps the focus).
  bar.addEventListener("mousedown", event => { if (!(event.target as Element).closest("input")) event.preventDefault(); });
  bar.addEventListener("click", event => {
    const control = (event.target as Element).closest<HTMLButtonElement>("button[data-bar]");
    if (!control || !editor || control.disabled) return;
    const id = control.dataset.bar!;
    const format = FORMATS.find(item => item.id === id);
    // The words have the focus before a press changes them (reached by the keyboard, the bar has it): ProseMirror then writes its
    // selection to the page, and reads none from it.
    if ((format || id === "math") && !editor.view.hasFocus()) editor.view.focus();
    if (format) { format.run(editor); later(); return; }
    if (id === "block") { chooseBlock(control); return; }
    if (id === "table") { chooseTable(control); return; }
    if (id === "link") { openLink(); return; }
    if (id === "apply") { applyLink(); return; }
    if (id === "close") { backToWords(); return; }
    if (id === "unlink") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); backToWords(); return; }
    if (id === "math") {
      const { from, to } = editor.state.selection, latex = editor.state.doc.textBetween(from, to, " ");
      if (latex.trim()) editor.chain().focus().insertContentAt({ from, to }, { type: "mathInline", attrs: { latex: latex.trim() } }).run();
      later();
    }
  });
  bar.addEventListener("keydown", event => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (linking || holding) { holding = false; backToWords(); } else { dismissed = true; close(); editor?.view.focus(); }
      return;
    }
    if (target.matches('input[data-bar="language"]')) {
      if (event.key === "Enter") { event.preventDefault(); editor!.chain().focus().updateAttributes("codeBlock", { language: (target as HTMLInputElement).value.trim().toLowerCase() }).run(); }
      return;
    }
    if (target.matches(".cmp-fmt-address")) { if (event.key === "Enter") { event.preventDefault(); applyLink(); } return; }
    // The arrows move along the bar (one stop at a time, as a toolbar does), and Home and End go to its ends.
    const items = [...formatRow().querySelectorAll<HTMLElement>("button:not([hidden]):not(:disabled)")];
    const at = items.indexOf(target.closest("button") as HTMLElement);
    const next = event.key === "ArrowRight" ? items[(at + 1) % items.length] : event.key === "ArrowLeft" ? items[(at - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0] : event.key === "End" ? items[items.length - 1] : undefined;
    if (next) { event.preventDefault(); items.forEach(item => { item.tabIndex = -1; }); next.tabIndex = 0; next.focus(); }
  });
  bar.addEventListener("focusout", event => {
    const to = (event as FocusEvent).relatedTarget as Node | null;
    if (to && (bar.contains(to) || host.contains(to))) return;
    holding = false;
    later();
  });

  // ----- the editor

  const extension = Extension.create({
    name: "composerToolbar",
    addProseMirrorPlugins() {
      editor = this.editor;
      return [new Plugin({
        key: new PluginKey("composer-toolbar"),
        view: () => ({
          update: (_view, before) => {
            const selection = this.editor.state.selection;
            // A new selection brings the bar back after Escape; the words changing under a caret that stayed does not.
            if (!before.selection.eq(selection) && !selection.empty) dismissed = false;
            later();
          },
          destroy: () => { close(); bar.remove(); },
        }),
        props: {
          handleKeyDown: (_view, event) => {
            // Alt+F10 goes to the bar.
            if (event.key === "F10" && event.altKey) { if (!shown) return false; holding = true; document.documentElement.setAttribute(KEYS_ATTRIBUTE, ""); const first = formatRow().querySelector<HTMLElement>("button:not([hidden]):not(:disabled)"); first?.focus(); return true; }
            return false;
          },
        },
      })];
    },
  });
  host.addEventListener("focusout", later);
  host.addEventListener("focusin", later);
  // Escape in the words closes the bar before it is anything else's (a task to cancel, a menu): the next one is the page's.
  host.addEventListener("keydown", event => {
    if (event.key === "Escape" && shown) { dismissed = true; close(); event.stopPropagation(); event.preventDefault(); }
  }, true);

  return {
    extension, openLink,
    destroy() { closeMenu(); close(); bar.remove(); host.removeEventListener("focusout", later); host.removeEventListener("focusin", later); },
  };
}
