import { checkMessagePaths, openMessagePath } from "./api";
import { t } from "./i18n";
import { toaster } from "./ui";

const candidate = "code[data-message-path]";
const link = 'code[data-message-path][role="link"]';

export function mountMessagePaths(root: HTMLElement): (scopes: Iterable<HTMLElement>) => void {
  const seen = new WeakSet<HTMLElement>();
  const open = (code: HTMLElement): void => {
    const member = code.closest<HTMLElement>("[data-path-member]");
    if (member) void openMessagePath(Number(member.dataset.pathMember), code.dataset.messagePath!)
      .catch(() => toaster.info(t("agent.pathUnavailable")));
  };
  root.addEventListener("click", event => {
    const code = (event.target as Element).closest<HTMLElement>(link);
    if (code && root.contains(code) && getSelection()?.isCollapsed !== false) open(code);
  });
  root.addEventListener("keydown", event => {
    const code = event.target as HTMLElement;
    if (event.key !== "Enter" || event.repeat || event.isComposing || !code.matches(link)) return;
    event.preventDefault();
    open(code);
  });

  return scopes => {
    const members = new Map<number, Map<string, HTMLElement[]>>();
    const queue = (code: HTMLElement): void => {
      if (seen.has(code)) return;
      const member = code.closest<HTMLElement>("[data-path-member]")?.dataset.pathMember;
      if (member === undefined) return;
      seen.add(code);
      const id = Number(member), path = code.dataset.messagePath!;
      const paths = members.get(id) ?? new Map<string, HTMLElement[]>();
      const nodes = paths.get(path) ?? [];
      nodes.push(code);
      paths.set(path, nodes);
      members.set(id, paths);
    };
    for (const scope of scopes) {
      if (scope.matches(candidate)) queue(scope);
      scope.querySelectorAll<HTMLElement>(candidate).forEach(queue);
    }
    for (const [id, paths] of members) {
      const names = [...paths.keys()];
      for (let start = 0; start < names.length; start += 64) {
        const batch = names.slice(start, start + 64);
        void checkMessagePaths(id, batch).then(({ allowed }) => {
          const trusted = new Set(allowed);
          for (const path of batch) {
            if (!trusted.has(path)) continue;
            for (const code of paths.get(path)!) {
              if (!root.contains(code)) continue;
              code.setAttribute("role", "link");
              code.tabIndex = 0;
            }
          }
        }).catch(() => { /* Unchecked paths remain plain text. */ });
      }
    }
  };
}
