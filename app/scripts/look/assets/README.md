# Recorded public catalog artwork

`slack.svg` is the unmodified public SVG response for
`https://logos.composio.dev/api/slack`, recovered from a recorded native run's
HTTP cache. It is Slack's brand artwork supplied by the Composio
catalog, retained only as offline visual-test evidence. Production continues to
use the catalog URL through the shared HTTPS Composio allowlist.

`fixture.json.imageResponses` maps that exact URL to this snapshot. The look
runner fulfills only the declared image request locally; all other external
requests still fail. This fixture does not prove current remote availability.

`catalog-square.svg` is synthetic, no brand's artwork: a 128 x 128 picture drawn to its edges, the
shape of the catalogue's own pictures (Outlook's is 128 x 128 with its logo filling the canvas). The
`appMarks` fixture serves it for `https://logos.composio.dev/api/outlook`, so that a list proves such a
picture is drawn in the same square as every other mark (R-UI-164), not as wide as its box.
