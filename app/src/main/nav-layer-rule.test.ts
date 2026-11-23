import { expect, test } from "vitest";
import ts from "typescript-6";

// Check the function that builds the layer. Render-only functions have an explicit link to the
// selector registered by their controller. A second builder in the same file needs its own link.
const renderOwners: Record<string, [string, string]> = {
  "providers.ts:directoryHTML": ["pv-dialog", "registerDismissal"],
  "providers.ts:dialogHTML": ["pv-dialog", "registerDismissal"],
  "services.ts:dialogHTML": ["svc-dialog", "registerDismissal"],
  "connections.ts:keyDialogHTML": ["cs-dialog", "registerDismissal"],
};

const registration = /\b(?:registerDismissal|bindNavLayer|openPopover|openDialog)\s*\(/;
// Escape also occurs in key decoding, history observation, focus routing and recording. These
// functions do not create a dismissible layer. Full-page navigation uses the named page view.
const keyOwners: Record<string, RegExp> = {
  "window-hotkeys.ts:handle": /voiceCapture/,
  "safety-rules.ts:key": /cancelEdit\(\)/,
  // The address field's Escape puts the page's own address back, as a browser's does: a field edit, not a layer.
  "host-browser-toolbar.ts:mountHostBrowserToolbar": /address\.value = shownUrl\(\)/,
  "ui.ts:listenForMenuEvents": /registerDismissal\(el, dismiss/,
};

function uncovered(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const missing = new Set<string>();
  function visit(node: ts.Node): void {
    const value = ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join("...")
      : ts.isStringLiteralLike(node) && !ts.isTemplateHead(node) ? node.text : "";
    const call = node.parent && ts.isCallExpression(node.parent) ? node.parent : undefined;
    const builder = /<[\w-]+\b[^<>]*\brole\s*=\s*["'](?:dialog|menu|listbox)["']/i.test(value)
      || (["dialog", "menu", "listbox"].includes(value) && (
        call?.expression.getText(tree).endsWith(".setAttribute") && call.arguments[0]?.getText(tree).match(/^["']role["']$/)
        || node.parent && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.parent.left.getText(tree).endsWith(".role")
      ));
    const parent = node.parent;
    const keyAccess = (text: string): boolean => /\.(key|code)$/.test(text);
    const escape = value === "Escape" && parent && (
      ts.isBinaryExpression(parent) && (keyAccess(parent.left.getText(tree)) || keyAccess(parent.right.getText(tree)))
      || ts.isCaseClause(parent) && ts.isSwitchStatement(parent.parent.parent) && keyAccess(parent.parent.parent.expression.getText(tree))
    );
    if (builder || escape) {
      let owner: ts.Node | undefined = node.parent;
      while (owner && !ts.isFunctionDeclaration(owner) && !ts.isMethodDeclaration(owner)
        && !(ts.isVariableDeclaration(owner) && owner.initializer && ts.isArrowFunction(owner.initializer))) owner = owner.parent;
      const name = owner && "name" in owner ? (owner.name as ts.Node | undefined)?.getText(tree) : "";
      const id = file + ":" + name;
      const link = renderOwners[id];
      const linked = link && value.includes(link[0]) && source.includes(link[1] + "(") && source.includes("#" + link[0]);
      let scope: ts.Node | undefined = owner;
      // A local Escape handler belongs to its enclosing controller. Independent top-level
      // functions must own their own registration, even in a file with another registered dialog.
      while (scope && !registration.test(scope.getText(tree))) {
        if (builder || ts.isSourceFile(scope.parent)) { scope = undefined; break; }
        scope = scope.parent;
        if (ts.isSourceFile(scope)) { scope = undefined; break; }
      }
      if (!scope && !linked && !(escape && keyOwners[id]?.test(source))) {
        missing.add(id + " line " + (tree.getLineAndCharacterOfPosition(node.getStart()).line + 1));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...missing];
}

test("every layer builder and Escape dismissal has a navigation owner", () => {
  const sources = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./i18n/**"], { eager: true, query: "?raw", import: "default" });
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  expect(Object.entries(sources).flatMap(([path, source]) => uncovered(path.slice(2), source))).toEqual([]);
});

test("an unrelated registered panel cannot cover a new unregistered dialog or Escape handler", () => {
  const source = `function known(el) { registerDismissal(el, close); }
    function forgotten(el) { el.setAttribute("role", "dialog"); }
    function menu() { return '<div role="menu"></div>'; }
    function escape(e) { if (e.key === "Escape") close(); }
    function nested(title) { return \`<div class="\${title}" role="dialog">\`; }
    function cases(e) { switch (e.code) { case "Escape": close(); } }`;
  expect(uncovered("new.ts", source)).toHaveLength(5);
});
