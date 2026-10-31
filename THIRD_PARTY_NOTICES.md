# Third-party notices

Raphael is MIT licensed. The following separately licensed work is used for the
optional Docker desktop and conversation pages. No OpenMausBot `enterprise/` code is included.

## OpenMausBot (Apache-2.0)

OpenMausBot
Copyright 2026 Milind Soni and OpenMausBot contributors

Upstream: https://github.com/milind-soni/OpenMausBot, revision
`f9191b5384b9900b2371696336439ae5ad6e0117`. The Apache-2.0 license is reproduced in
`licenses/Apache-2.0.txt`.

Modified ports and adaptations, with upstream file names:

- `core/src/raphael_core/agent/pages.py`: Python adaptation of the HTML limits,
  bounded revision history, CDN CSP allowlist and document preamble handling from
  `shared/app.ts`, `shared/app-frame/csp.ts`, `shared/app-frame/document.ts`
  and `server/chat-apps.ts`. Helper messages and MCP resource/visibility handling
  in `integrations/client.py`, `integrations/service.py` and `connectors/mcp.py`
  follow the contracts in `shared/app-frame/bridge.ts` and `server/chat-apps-mcp.ts`.
  Raphael uses its own loopback HTTP origin, storage and existing permission gate.
- `core/src/raphael_core/computer/image/Dockerfile`: port of
  `server/container-computer.ts::managedImageDockerfile()`, including image,
  wheel and font pins, profile preparation and supervisord startup. Paths and
  labels use Raphael's namespace.
- `core/src/raphael_core/computer/vm.py`: adapted Docker lifecycle, hardening,
  health and exec contracts from `server/container-computer.ts` and
  `server/container-limits.ts`; idle/control concepts from
  `server/computer-idle.ts` and `server/computer-control.ts`. SSH transport validation
  and loopback viewer forwards in `computer/vm.py` and `computer/ssh_tunnel.py`
  adapt `server/vps-computer.ts` and `server/vps-ssh.ts`; Raphael uses the owner's
  existing SSH configuration and does not read or copy private keys.
- `core/src/raphael_core/computer/vm_bridge.py`: adapted ping, schema and
  owner-control bridge concepts from `server/container-mcp.ts` and
  `server/mcp-bridge.ts`. Python implementation for Raphael's existing gate.
  Root-schema normalization follows `server/mcp-tool-schema.ts`.
- `core/src/raphael_core/computer/vm_tools.py`: Python adaptation of the desktop
  lease and workspace-file tool contracts from `server/local-vm-lease.ts` and
  `server/drivers/agents-catalog.ts`, integrated with Raphael's tool gate.

These files are offered under Apache-2.0; unchanged upstream notices, if any,
remain applicable. OpenMausBot's license grants no trademark rights.

## Hermes Agent: context compression (MIT)

Upstream: https://github.com/NousResearch/hermes-agent, revision `c419cf7c`.

`core/src/raphael_core/worker/context.py` is adapted from `agent/context_compressor.py`
(the per-tool result summaries, the refused-call summary, deduplication, tool-pair repair, boundary
alignment, the static fallback summary, the cooldown ladder and anti-thrash),
`agent/turn_overflow.py` and `agent/model_metadata.py` (telling an overflow from an output cap, and
reading a provider's limits from its error) and `agent/usage_anchor.py` (real usage plus an estimate
of what came since). The result limit in `core/src/raphael_core/worker/guards.py` follows
`tools/budget_config.py`. Its checkpoint template is rewritten for Raphael, and also draws on
opencode (`packages/core/src/session/compaction.ts`, revision `bf544cd4`, MIT, Copyright (c) 2025
opencode).

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Cua Driver and desktop image (MIT)

Upstream: https://github.com/trycua/cua

The Dockerfile installs the pinned `cua-driver` 0.37.0 Linux wheel and checks its
SHA-256. The base image is pinned by digest. The upstream MIT license is retained
in the image/package; redistribution must preserve it.

## noVNC (MPL-2.0)

Upstream: https://github.com/novnc/noVNC

The pinned Cua desktop image includes noVNC. Raphael proxies its `/vnc.html`,
styles and unmodified RFB modules through a loopback bridge. The bridge replaces
the standalone page's script entry with Raphael's own bootstrap in
`core/src/raphael_core/computer/viewer.py`; the container files are unchanged.
The original page copyright comments and image license/source notices remain.
Source is available at the upstream URL. No noVNC JavaScript is copied into
Raphael's frontend.

## Noto Sans CJK JP (SIL OFL-1.1)

Upstream: https://github.com/notofonts/noto-cjk

The image installs the pinned Noto Sans CJK JP Regular font. Its pinned OFL-1.1
license is installed at `/usr/local/share/licenses/noto-cjk/OFL.txt` in the image.

## Hermes Agent: retries and failure kinds (MIT)

Upstream: https://github.com/NousResearch/hermes-agent, revision `c419cf7c`.

- `core/src/raphael_core/retry_utils.py`: adapted from `agent/retry_utils.py`
  (`parse_retry_after_seconds`, the "resets in" / "retry after" grammar behind
  `reset_delay_from_message`, `jittered_backoff`, `provider_retry_after_seconds`).
  Its Z.AI schedule is left out.
- `core/src/raphael_core/failures.py`: the words that tell a spent quota from a throttle, a
  context that does not fit and a filtered prompt come from the pattern tables of
  `agent/error_classifier.py`, narrowed to the general kinds.
- `core/src/raphael_core/brain/streams.py`: how long a silent stream may stay silent follows
  the stale-stream timeouts of `agent/chat_completion_helpers.py` and
  `agent/reasoning_timeouts.py`.

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# Rich content dependency notices

Mermaid 11.12.2 is MIT; highlight.js 11.11.1 is BSD-3-Clause. Both load lazily.

The lockfile adds 125 package paths, with no unrelated version changes.
Transitive declared licences: MIT, Apache-2.0, ISC, BSD-3-Clause, (MPL-2.0 OR Apache-2.0), MIT (verified in installed license file), Unlicense.
For package versions and licences, see .fold/rich-content-dependencies.json.

## Mermaid

The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## highlight.js

BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


# Hermes Agent (MIT)

Hermes Agent
Copyright (c) 2025 Nous Research

Upstream: https://github.com/NousResearch/hermes-agent, revision `c419cf7c`.

Adapted for the tool loop of the background worker and the in-process API loop, with upstream file names.
Each adapted file carries a header with its upstream path and revision:

- `core/src/raphael_core/worker/tool_guardrails.py`: from `agent/tool_guardrails.py` (the identical-call
  streak, the repeating-cycle detection, the failure counters, the failure-tolerant tools, the progress
  reset and the unattended hard stop).
- `core/src/raphael_core/worker/repetition_guard.py`: from `agent/repetition_guard.py`.
- `core/src/raphael_core/worker/stall_guards.py`: the end-of-reply pattern from
  `agent/agent_runtime_helpers.py` and the continuation notes from `agent/conversation_loop.py`.

The MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.