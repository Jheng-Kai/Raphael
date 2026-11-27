// The parts of the field that are more than a tag: a toggle's arrow, a task's box, an equation drawn by KaTeX.
import type { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { mathHTML } from "./math-html";
import { t } from "./i18n";

type Position = () => number | undefined;

/** A control inside the text that is not text: the editor leaves it alone, and so do its mutations. */
function control(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.contentEditable = "false";
  return element;
}

/** A press on a control changes the document without taking the caret from the words. */
function press(element: HTMLElement, act: () => void): void {
  element.addEventListener("mousedown", event => event.preventDefault());
  element.addEventListener("click", event => { event.preventDefault(); act(); });
  element.addEventListener("keydown", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); act(); } });
}

const reaches = (event: Event, ...controls: (HTMLElement | undefined)[]): boolean => controls.some(element => element?.contains(event.target as Node));

/** A toggle: the summary's line with its arrow, and what is under it while it is open. */
export class ToggleView implements NodeView {
  dom = document.createElement("div");
  contentDOM = this.dom;
  constructor(private node: PMNode) { this.dom.className = "cmp-toggle"; this.draw(); }
  private draw(): void {
    const open = this.node.attrs.open !== false;
    this.dom.dataset.open = String(open);
    const arrow = this.dom.querySelector<HTMLElement>(":scope > .cmp-toggle-head > .cmp-toggle-arrow");
    arrow?.setAttribute("aria-expanded", String(open));
    arrow?.setAttribute("aria-label", t(open ? "composer.toggleClose" : "composer.toggleOpen"));
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node; this.draw();
    return true;
  }
}

export class SummaryView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("div");
  private arrow = control("span", "cmp-toggle-arrow");
  constructor(private view: EditorView, private position: Position) {
    this.dom.className = "cmp-toggle-head";
    this.contentDOM.className = "cmp-toggle-title";
    this.arrow.setAttribute("role", "button");
    this.arrow.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    this.dom.append(this.arrow, this.contentDOM);
    this.label();
    press(this.arrow, () => this.toggle());
  }
  private parent(): { pos: number; node: PMNode } | undefined {
    const at = this.position();
    if (at === undefined) return undefined;
    const $pos = this.view.state.doc.resolve(at);
    return { pos: $pos.before(), node: $pos.parent };
  }
  private label(): void {
    const open = this.parent()?.node.attrs.open !== false;
    this.arrow.setAttribute("aria-label", t(open ? "composer.toggleClose" : "composer.toggleOpen"));
    this.arrow.setAttribute("aria-expanded", String(open));
  }
  private toggle(): void {
    const parent = this.parent();
    if (!parent) return;
    const { state } = this.view, open = !parent.node.attrs.open;
    let tr = state.tr.setNodeMarkup(parent.pos, undefined, { ...parent.node.attrs, open });
    // A closed toggle hides its lines: the caret does not stay in them.
    if (!open && state.selection.from > parent.pos + 1 + parent.node.firstChild!.nodeSize) tr = tr.setSelection(TextSelection.create(tr.doc, parent.pos + 1 + parent.node.firstChild!.nodeSize - 1));
    this.view.dispatch(tr);
    this.view.focus();
  }
  update(node: PMNode): boolean {
    if (node.type.name !== "summary") return false;
    queueMicrotask(() => this.label());
    return true;
  }
  stopEvent(event: Event): boolean { return reaches(event, this.arrow); }
  ignoreMutation(mutation: { target: Node }): boolean { return !this.contentDOM.contains(mutation.target); }
}

/** An item of a list: a plain one is the browser's, a task has its box. */
export class ItemView implements NodeView {
  dom = document.createElement("li");
  contentDOM: HTMLElement;
  private box?: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private position: Position) {
    if (node.attrs.checked === null) { this.contentDOM = this.dom; return; }
    this.dom.className = "cmp-task";
    this.box = control("span", "cmp-task-box");
    this.box.setAttribute("role", "checkbox");
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "cmp-task-body";
    this.dom.append(this.box, this.contentDOM);
    press(this.box, () => this.flip());
    this.draw();
  }
  private draw(): void {
    if (!this.box) return;
    const checked = this.node.attrs.checked === true;
    this.dom.dataset.checked = String(checked);
    this.box.setAttribute("aria-checked", String(checked));
    this.box.setAttribute("aria-label", t("composer.task"));
  }
  private flip(): void {
    const at = this.position();
    if (at === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(at, undefined, { ...this.node.attrs, checked: this.node.attrs.checked !== true }));
    this.view.focus();
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type || (node.attrs.checked === null) !== (this.node.attrs.checked === null)) return false;
    this.node = node; this.draw();
    return true;
  }
  stopEvent(event: Event): boolean { return reaches(event, this.box); }
  ignoreMutation(mutation: { target: Node }): boolean { return !this.contentDOM.contains(mutation.target) || (mutation.target === this.dom); }
}

/** An inline equation: one unit, drawn; Backspace after it puts its source back (composer-rich-field.ts). */
export class MathInlineView implements NodeView {
  dom = control("span", "cmp-math");
  constructor(private node: PMNode) { this.draw(); }
  private draw(): void {
    this.dom.innerHTML = mathHTML(this.node.attrs.latex, false);
    this.dom.dataset.latex = this.node.attrs.latex;
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.latex !== this.node.attrs.latex) { this.node = node; this.draw(); }
    return true;
  }
  selectNode(): void { this.dom.classList.add("is-selected"); }
  deselectNode(): void { this.dom.classList.remove("is-selected"); }
  ignoreMutation(): boolean { return true; }
}

/** A display equation: the LaTeX the owner writes, and the equation drawn under it. */
export class MathBlockView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("div");
  private shown = control("div", "cmp-math-shown");
  constructor(private node: PMNode) {
    this.dom.className = "cmp-math-block";
    this.contentDOM.className = "cmp-math-source";
    this.contentDOM.spellcheck = false;
    this.dom.append(this.contentDOM, this.shown);
    this.draw();
  }
  private draw(): void {
    const latex = this.node.textContent.trim();
    this.dom.dataset.empty = String(!latex);
    this.shown.innerHTML = latex ? mathHTML(latex, true) : "";
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node; this.draw();
    return true;
  }
  stopEvent(event: Event): boolean { return reaches(event, this.shown); }
  ignoreMutation(mutation: { target: Node }): boolean { return !this.contentDOM.contains(mutation.target); }
}
