// Native toasts share one style, including errors. Only explicitly expected success text is exempt.
export function toastError(text) {
  return !/^(Deleted |已刪除|削除しました|Created |已建立「|「[^\r\n]+」を作成しました$|Cleared the history of “[^\r\n]+”$|已清除「[^\r\n]+」的紀錄$|「[^\r\n]+」の履歴を消去しました$)/u.test(text.trim());
}

export function paidRequests(log, gmail = false) {
  return log.split(/\r?\n/).filter(line => {
    const urls = line.match(/https?:\/\/[^\s"<>]+/gi) || [];
    return urls.some(value => {
      const host = new URL(value).hostname;
      if (["127.0.0.1", "localhost", "tauri.localhost"].includes(host)) return false;
      if (gmail && /(^|\.)composio\.(dev|ai)$/.test(host)) return false;
      // Fail closed for unknown providers too, including custom paid API base URLs.
      return true;
    });
  });
}

export async function collectErrors(page, errors) {
  const add = (kind, message) => errors.push({ kind, message, at: new Date().toISOString() });
  page.on("pageerror", error => add("exception", error.stack || error.message));
  page.on("console", message => { if (message.type() === "error") add("console", message.text()); });
  await page.exposeFunction("nativeJourneyError", (kind, message) => {
    if (kind !== "toast" || toastError(message)) add(kind, message);
  });
  await page.evaluateOnNewDocument(() => {
    addEventListener("unhandledrejection", event => void window.nativeJourneyError("unhandledrejection", String(event.reason?.stack || event.reason)));
    const seen = new WeakMap();
    const inspect = () => {
      for (const element of document.querySelectorAll('.toast, [role="alert"], [data-card-error]')) {
        const text = element.textContent.trim();
        if (element.getBoundingClientRect().width && text && seen.get(element) !== text) {
          seen.set(element, text); void window.nativeJourneyError("toast", text);
        }
      }
    };
    addEventListener("DOMContentLoaded", () => {
      inspect();
      new MutationObserver(inspect).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
  });
}
