// Read-only startup instrumentation installed before the real main entry, without reloading it.
(() => {
  const probe = window.__nativeStartup = { startedAt: Date.now(), visibility: [], coreReady: [], rows: [], errors: [], alerts: [] };
  const visibility = () => probe.visibility.push({ at: Date.now(), state: document.visibilityState });
  visibility(); document.addEventListener("visibilitychange", visibility);
  const info = console.info.bind(console);
  console.info = (...args) => { if (args[0] === "main page: CoreReady") probe.coreReady.push(Date.now()); info(...args); };
  const error = console.error.bind(console);
  console.error = (...args) => { probe.errors.push(args.map(String).join(" ")); error(...args); };
  addEventListener("error", event => probe.errors.push(String(event.error?.stack || event.message)));
  addEventListener("unhandledrejection", event => probe.errors.push(String(event.reason?.stack || event.reason)));
  let previous = "";
  const seen = new WeakMap();
  new MutationObserver(() => {
    for (const element of document.querySelectorAll('.toast, [role="alert"], [data-card-error]')) {
      const text = element.textContent.trim();
      if (element.getBoundingClientRect().width && text && seen.get(element) !== text) {
        seen.set(element, text); probe.alerts.push(text);
      }
    }
    const rows = [...document.querySelectorAll('.au-rooms-section [data-room]')]
      .filter(row => row.getBoundingClientRect().width && row.checkVisibility())
      .map(row => ({ id: Number(row.dataset.room), name: row.querySelector('b')?.textContent }));
    const key = JSON.stringify(rows);
    if (key !== previous) { previous = key; probe.rows.push({ at: Date.now(), rows }); }
  }).observe(document, { childList: true, subtree: true, attributes: true });
})();
