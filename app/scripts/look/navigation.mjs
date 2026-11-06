/** Pre-transform each selected entry and its static imports before the first browser navigation. */
export async function warmupEntries(server, entries, readEntry) {
  for (const entry of new Set(entries)) {
    await server.transformIndexHtml(`/${entry}`, await readEntry(entry));
    await server.environments.client.waitForRequestsIdle();
  }
}

/** Keep real request failures, excluding only aborts belonging to a superseded document. */
export function navigationRequests(page) {
  let navigation = 0, committedDocument = 0;
  const documents = new WeakMap(), failures = [];
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation++;
    documents.set(request, navigation);
  });
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) committedDocument = navigation; });
  page.on("requestfailed", request => failures.push({ request, document: documents.get(request) }));
  return () => failures.map(failure => ({
    url: failure.request.url(),
    message: `${failure.request.url()}: ${failure.request.failure()?.errorText}`,
    superseded: failure.request.failure()?.errorText === "net::ERR_ABORTED"
      && failure.document !== undefined && failure.document < committedDocument,
  }));
}
