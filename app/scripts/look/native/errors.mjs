// Native toasts share one style, including errors. Only explicitly expected success text is exempt.
export function toastError(text) {
  return !/^(Deleted |已刪除|削除しました|Created |已建立「|「[^\r\n]+」を作成しました$|Cleared the history of “[^\r\n]+”$|已清除「[^\r\n]+」的紀錄$|「[^\r\n]+」の履歴を消去しました$)/u.test(text.trim());
}

export function paidRequests(log, gmail = false, declared = []) {
  return log.split(/\r?\n/).filter(line => {
    const urls = line.match(/https?:\/\/[^\s"<>]+/gi) || [];
    return urls.some(value => {
      const host = new URL(value).hostname;
      if (["127.0.0.1", "localhost", "tauri.localhost"].includes(host)) return false;
      if (gmail && /(^|\.)composio\.(dev|ai)$/.test(host)) return false;
      if (declared.includes(host)) return false;
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
  await page.evaluateOnNewDocument(installErrorWatch);
}

/** Watch changed alerts without forcing a whole-document layout for every animated SVG attribute. */
export function installErrorWatch() {
    addEventListener("unhandledrejection", event => void window.nativeJourneyError("unhandledrejection", String(event.reason?.stack || event.reason)));
    const seen = new WeakMap(), pending = new Set(), alerts = new Set();
    const selector = '.toast, [role="alert"], [data-card-error]';
    let queued = false;
    const inspect = () => {
      queued = false;
      for (const element of pending) {
        if (!element.isConnected) { alerts.delete(element); continue; }
        const text = element.textContent.trim();
        if (text && seen.get(element) !== text && element.getBoundingClientRect().width) {
          seen.set(element, text); void window.nativeJourneyError("toast", text);
        }
      }
      pending.clear();
    };
    const discover = node => {
      if (!(node instanceof Element)) return;
      if (node.matches(selector)) { alerts.add(node); pending.add(node); }
      for (const alert of node.querySelectorAll(selector)) { alerts.add(alert); pending.add(alert); }
    };
    addEventListener("DOMContentLoaded", () => {
      discover(document.body); inspect();
      new MutationObserver(records => {
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          const alert = target?.closest(selector);
          if (alert) { alerts.add(alert); pending.add(alert); }
          for (const node of record.addedNodes) discover(node);
          if (record.type === 'attributes') for (const known of alerts) if (target?.contains(known)) pending.add(known);
        }
        if (pending.size && !queued) { queued = true; requestAnimationFrame(inspect); }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter:['class','style','hidden','role','data-card-error'] });
    });
}
