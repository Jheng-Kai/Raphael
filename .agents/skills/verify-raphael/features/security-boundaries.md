# Agent and external-input security boundaries (2026-11-05)

This map covers the offline core security review in `u-sec2`. It adds no UI,
navigation, RPC, credential store or parallel execution engine. See the handoff
report `.fold/report.md` for red/green evidence, exclusions and owner decisions.

## Contracts and regression checks

| Boundary | Behavior | Existing verification entry |
| --- | --- | --- |
| Telegram, Slack and Discord (R-AG-14, R-BATCH-04, A-12) | At most 64 pending switchboard tasks; overflow is dropped. Recheck the current allowlist after waiting for a chat, after attachment download/transcription and before sending the answer. Revocation prevents queued work and delivery of an in-flight answer; it does not undo an already dispatched model/tool call. | `core/tests/messaging/test_switchboard.py`: revoked-chat, attachment-revocation and incoming-flood tests; `core/tests/messaging/` |
| Webhooks and tunnel probes (R-RT-03, A-05/12) | At most 64 admitted clients; excess clients receive 503. Recheck the vault secret after reading the body. Probe HMACs bind a separate purpose and single-use nonce and cannot authenticate a normal delivery. Deliveries have a persistent 24-hour replay cache, capped at 16,384 hashed keys / 3 MiB. Duplicate deliveries receive 409; capacity, corruption or persistence failure receives 503. Existing exact-body HMAC and Sentry/PagerDuty Bearer recipes remain supported. | `core/tests/members/test_webhooks.py`: rotated-secret, excess-client, external-probe-replay, recipe delivery-ID, headerless replay, restart and capacity tests |
| Signed delivery timestamps (R-RT-03, A-12) | Optional `X-Raphael-Timestamp` contains Unix seconds and is signed as `HMAC-SHA256(secret, b"raphael-webhook-delivery\x00" + timestamp + b"\x00" + body)`. Reject timestamps outside +/- 5 minutes. Adding an unsigned timestamp to a captured legacy body signature is refused. Native provider signatures stay at the trusted recipe forwarder; relayed `Sentry-Hook-Timestamp` / `X-PagerDuty-Timestamp` require its Bearer authority and the same age window. Do not infer delivery age from an event's occurrence time. | `core/tests/members/test_webhooks.py`: signed timestamp window, forwarder timestamp and captured-signature timestamp tests |
| Store catalogue freshness (R-STORE-02, A-12) | Store import needs a signed index revalidated within seven days, before and after package download. Persist the verification time; online 304 revalidation renews it, loading a disk cache does not. Older or legacy caches still support browsing/preview, but adding asks the owner to connect to confirm the template has not been revoked. Local file imports are unchanged. | `core/tests/members/test_member_catalog.py`: seven-day boundary, restart/legacy cache, 304 renewal and post-download age tests, all with a fake clock |
| Managed MCP HTTP (R-MCP-CHAT-02, A-05/12) | Stop reading after 2,000,000 wire or decoded bytes; gzip inflation has a bounded output allocation. Advertise gzip only; accept identity/gzip and refuse unsupported or malformed encodings. Close an oversized stream before its remaining tail is read. No change to custom MCP's SDK transport. | `core/tests/test_connectors.py`: oversized-response, gzip-inflation and bounded plain/compressed-result tests |
| Google OAuth callback (A-05/12) | Wrong host/state or malformed unauthenticated callbacks do not consume the owner's login. Claim the single-use callback only after validating method/path/host/state; a later valid callback can complete. | `core/tests/test_connectors.py::test_google_callback_without_authority_cannot_consume_the_login`; in-memory streams and a fake server, no socket |
| Exact owner approval (R-AG-MGMT-01/02/03, A-03/04/12) | Keep current-primary private-interactive authorization and exact-action single-use approval, including firm destructive management under bypass. No new authority is granted by this change. | `core/tests/agent/test_gate.py`; `core/tests/members/test_management.py`; `core/tests/architecture/` |

## Verification scope and limits

Run the affected core modules and architecture contracts through the existing
pytest workflow. The strict offline run excludes existing tests named
`real_loopback`, `loopback_state`, `cli`, `codex` or `claude`, because those may
open local listeners or start CLI boundaries. See the report for the exact
commands and separate baseline failures in the extended member/catalogue scope.

No visual scene is affected: look and judge are not applicable. Native gateways,
real OAuth, tunnel delivery, custom MCP servers, live models and provider actions
remain unverified. Do not equate wrapper tests with proof against model prompt
injection. Follow-up 1 fixes delivery replay and catalogue freshness. The owner
keeps broad bypass grants with the existing firm floor; malicious-source influence
within those grants remains an accepted risk, described plainly in the report.
