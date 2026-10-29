# Third-party notices

Raphael is MIT licensed. The following separately licensed work is used for the
optional Docker desktop. No OpenMausBot `enterprise/` code is included.

## OpenMausBot (Apache-2.0)

OpenMausBot
Copyright 2026 Milind Soni and OpenMausBot contributors

Upstream: https://github.com/milind-soni/OpenMausBot, revision
`f9191b5384b9900b2371696336439ae5ad6e0117`. The Apache-2.0 license is reproduced in
`licenses/Apache-2.0.txt`.

Modified ports and adaptations, with upstream file names:

- `core/src/raphael_core/computer/image/Dockerfile`: port of
  `server/container-computer.ts::managedImageDockerfile()`, including image,
  wheel and font pins, profile preparation and supervisord startup. Paths and
  labels use Raphael's namespace.
- `core/src/raphael_core/computer/vm.py`: adapted Docker lifecycle, hardening,
  health and exec contracts from `server/container-computer.ts` and
  `server/container-limits.ts`; idle/control concepts from
  `server/computer-idle.ts` and `server/computer-control.ts`.
- `core/src/raphael_core/computer/vm_bridge.py`: adapted ping, schema and
  owner-control bridge concepts from `server/container-mcp.ts` and
  `server/mcp-bridge.ts`. Python implementation for Raphael's existing gate.
  Root-schema normalization follows `server/mcp-tool-schema.ts`.
- `core/src/raphael_core/computer/vm_tools.py`: Python adaptation of the desktop
  lease and workspace-file tool contracts from `server/local-vm-lease.ts` and
  `server/drivers/agents-catalog.ts`, integrated with Raphael's tool gate.

These files are offered under Apache-2.0; unchanged upstream notices, if any,
remain applicable. OpenMausBot's license grants no trademark rights.

## Cua Driver and desktop image (MIT)

Upstream: https://github.com/trycua/cua

The Dockerfile installs the pinned `cua-driver` 0.37.0 Linux wheel and checks its
SHA-256. The base image is pinned by digest. The upstream MIT license is retained
in the image/package; redistribution must preserve it.

## noVNC (MPL-2.0)

Upstream: https://github.com/novnc/noVNC

The pinned Cua desktop image includes noVNC. Raphael uses the image's unmodified
web client at `/vnc.html`. Its MPL-2.0 license and source notices remain in the
image; source is available at the upstream URL. No noVNC JavaScript is copied
into Raphael's frontend.

## Noto Sans CJK JP (SIL OFL-1.1)

Upstream: https://github.com/notofonts/noto-cjk

The image installs the pinned Noto Sans CJK JP Regular font. Its pinned OFL-1.1
license is installed at `/usr/local/share/licenses/noto-cjk/OFL.txt` in the image.
