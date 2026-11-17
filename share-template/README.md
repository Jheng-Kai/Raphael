# Raphael share service

A small Cloudflare Worker behind Raphael's one-press "share a member" link. A member is shared as a `.raphael-member` v1 recipe
(name, role, personality, instructions, reply style, an optional description, skills with their files, routines and app names;
never memory, credentials or permissions). The Worker keeps the recipe, answers with a link, and shows whoever opens the link a
plain preview page with one button that downloads the recipe for Raphael. Nobody needs a GitHub account.

It is one file, `worker.mjs`, with no dependencies, and one Workers KV namespace named `SLIMES`. Copy this directory anywhere; it
does not touch the signed catalogue in `catalog-template/`.

## Opening the service: the steps that are the owner's

Raphael's repository holds no Cloudflare account, token or key, and none is created for you. These steps use a free Cloudflare
account and run on your own computer.

1. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up. No payment method is needed for the free plan.
2. **Sign in from the command line.** In this directory run `npx wrangler login` and approve the browser window it opens.
3. **Make the storage.** Run `npx wrangler kv namespace create SLIMES`. It prints an `id`.
4. **Paste the id.** Put it in `wrangler.toml` in place of `PASTE_THE_NAMESPACE_ID_HERE`.
5. **Deploy.** Run `npx wrangler deploy`. It prints an address such as `https://raphael-share.<your-name>.workers.dev`.
6. **Give that address to Raphael.** Put it, without a trailing slash, in `SHARE_URL` of
   `core/src/raphael_core/members/share_link.py` and ship a Raphael release. A Raphael with an empty `SHARE_URL` offers no link and
   sends nothing anywhere; its member cards keep the file and the catalogue request. A developer can try their own deployment with
   the `RAPHAEL_SHARE_URL` environment variable instead.

To use your own domain, add it to the Worker in the Cloudflare dashboard (Workers, Settings, Domains and Routes) and give Raphael
that address instead.

## What it answers

| Request | Answer |
| --- | --- |
| `POST /v1/slimes` with `{"template": {...}}` | `201` with `id`, `url` (`<address>/s/<id>`) and `token` |
| `GET /v1/slimes/<id>` | `200` with `{"template": {...}}`, or `404` |
| `DELETE /v1/slimes/<id>` with `Authorization: Bearer <token>` | `204`, `403` for a wrong or missing token, `404` for an unknown id |
| `GET /s/<id>` | the preview page, in Traditional Chinese for `zh-TW`, `zh-Hant` and `zh-HK` browsers and English otherwise |
| `GET /s/<id>/member.raphael-member` | the recipe as a downloadable file |

Anything else is `404`; a known address with the wrong method is `405`. No CORS headers are sent: Raphael calls from its own
core, not from a browser page.

A share must be a JSON object with only the key `template`. The template needs a non-empty `name` of at most 80 characters and
`skills` and `routines` lists. A body over 512 KiB is refused with `413`, anything else that does not fit with `400`.

## Limits

- **One recipe is at most 512 KiB.**
- **30 shares a day per client**, counted by the `CF-Connecting-IP` address and the UTC date; the counter expires after two days.
  Past 30 the Worker answers `429`.
- **The free plan allows 1000 KV writes a day for the whole account.** A share costs two writes (the recipe and the client's
  counter) and a delete costs one, so about 500 shares a day fit before Cloudflare itself refuses writes until the next UTC day.
  Reads (100000 a day on the free plan) are not a concern for a preview page. A free namespace holds 1 GB.
- The per-client counter is a read followed by a write, so a burst of parallel requests from one client can slip a few shares past 30.
  It is a courtesy limit, not a security boundary.
- Recipes are kept until their sharer deletes them; the Worker never expires them.

## Privacy

- **Links are unlisted.** Nothing lists or searches recipes, and the preview page asks search engines not to index it. The id is
  10 random letters and digits, so it can not be guessed in practice.
- **Anyone with the link can read the recipe**, including every skill file and routine prompt in it. Share only what you would
  hand to anyone.
- **The sharer can delete it.** The `token` is returned once, when the recipe is shared, and Raphael keeps it on the sharing
  computer. Only its SHA-256 is stored here, so the service can not show or recover it. The `DELETE` request above removes the
  recipe at once.
- The preview page has no scripts, images, cookies or trackers, and sends no referrer. Every value from a recipe is escaped before
  it is shown, because a recipe is written by someone else.
- Cloudflare keeps ordinary request logs for a Worker, as for any site. This service stores no address except the client counter,
  which is keyed by it for at most two days.
- No credential is stored by Raphael's repository. The Cloudflare login, the namespace id and the Worker belong to your own account.
