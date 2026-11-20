# Raphael product rules: general

Sections with no rule row of their own. Part of [the product rules](../RULES.md); a rule's ID is unique across every file.

## Member computer hosts

R-COMP-HOST supersedes the shared-desktop default: every member lazily receives a
separate computer and browser profile. Sign-ins remain per member. A team folder at
`/home/cua/team` is shared; members sign in separately. Settings offers one shared
location dropdown (This computer / Another computer), with an SSH config alias for
the latter. A configured alias selects the remote engine; otherwise installed local
Docker is used. With neither, the rest of the app works and the existing computer
settings explains the missing runtime and offers installation or another host.

Remote host check (R-COMP-HOST-01). "Check host" reports the truth about what a real start
needs, and for every failure says which of these is missing and shows the one command or config snippet that fixes it,
copyable, with no wizard or new screen: an alias in this PC's ssh config (`ssh_alias_unknown`: a `Host` snippet to
fill in), the host key accepted once (`ssh_hostkey`: `ssh <alias>`; `ssh_hostkey_changed`: `ssh-keygen -R <host>`),
key login without a password prompt (`ssh_key`: `ssh-keygen -t ed25519` and `ssh-copy-id <alias>`, or the PowerShell
pipe on Windows), a reachable SSH server (`ssh_unreachable`), Docker installed (`docker_missing`), `docker` on the
non-interactive PATH (`docker_path`), Docker running (`docker_stopped`) and usable by that account (`docker_access`).
A reachable host with a running Docker and no image yet is healthy: the real start pulls and builds the image on the
host's own engine, so `image_pending` is a note ("the first start prepares it, roughly 5 to 15 minutes"), never a
failure and never a command. An image built for another architecture (`architecture`) is the only image failure, and
its fix removes that image on the host. Every command shown is pasted on this PC, reaches the host through
`ssh <alias>` or sets up this PC's own ssh, and never builds anything from the app's sources, which an installed app
does not have. Docker Desktop on a Mac cannot be installed over ssh, so that class shows words and no command.

Remote Docker uses a validated `ssh://alias`, no published viewer port, named
workspace/team volumes on that engine, and a temporary random loopback SSH viewer
forward. It never starts Docker Desktop on this PC. Local idle-stop remains 15
minutes; remote desktops have no idle-stop. New v4 containers have a 3 GiB memory/swap cap
(not a reservation) and two CPUs. Local starts keep at most two running owned computers, counting
old incompatible containers without stopping them. Only a compatible, longest-idle
computer with no work or owner lease may be evicted; otherwise
report capacity. Remote hosts have no such limit.

The member viewer has one dark neutral frame in both themes, the member's name,
and a collapse control at the top right. It preserves the current stream and
handback nonce. The image has a plain wallpaper and one small bottom-centred dock
with Browser, Files and Terminal. No browser starts with the desktop. Task teaching
is outside scope. AT-SPI and websockify stay until real driver/viewer compatibility
can be established.

## Conversation-managed connections

R-MCP-CHAT-01: a custom MCP server is an editable conversation card. Public configuration and secret names may be proposed; values cross only the existing masked secret card into the vault. Initialization and discovery must succeed for the exact configuration before owner enable. Stdio testing uses the existing local-command consent and setting; allow-all skips yes, never a forbid, disabled local commands or secret-store protection. Saving a secret alone does not claim the task resumed. Stop rejects late discovery.

R-MCP-CHAT-02: connections_list and manage_connection use the existing connection and connector services. App/tool enable, disable, disconnect and reconnect apply to API, authenticated CLI MCP and background offers and to the check immediately before execution. A stale alias receives a refusal explaining the new state. Disconnect follows the shared mutation approval. No extra Settings page or preference is added.

Offline evidence: core/tests/integrations/test_chat_connections.py, core/tests/agent/test_connection_management.py, core/tests/background/test_connection_offers.py and app/src/main/mcp-proposal.test.ts. Selected real-entry scenes and limitations are mapped in features/connections-mcp.md. These rules extend R-AG-35 and R-OWNER-02.
