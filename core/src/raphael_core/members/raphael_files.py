"""What schema 101 (`brain/raphael_split.py`) leaves on disk: the files of the member 0 that became a slime.

The migration moves rows; this moves the things next to them, once, at start-up and before anything reads them:

- the notes and skills of its memory (`bots/0`, `bot-state/0` -> `bots/N`, `bot-state/N`);
- its cover (`avatars/covers/0.*` -> `N.*`) and the picture the owner uploaded (`avatars/members/0-*` -> `N-*`);
- its messaging bot (`messaging.json` and the vault's secrets: the account `telegram` -> `member:N:telegram`);
- its own computer's workspace on this PC and its own folder in the shared computer's workspace.

Raphael starts again beside them, with nothing of the slime's. Every step runs only when its source is there and its
target is not, so running it twice moves nothing twice; a step that fails is logged (never what it held), left as it
was, and tried again at the next start. `settings.raphael_split_files` records that every step is done.
Nothing here is the owner's to answer: a computer that lives in Docker keeps its container and its volume under its
old name, and the slime's next computer starts from the workspace this moves.
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DONE_KEY = "raphael_split_files"
PLATFORMS = ("telegram", "slack", "discord")
# The vault names of what each messaging app keeps (`messaging/channels`: ChannelType.secrets).
SECRETS = {"telegram": ("bot_token",), "slack": ("token",), "discord": ("token",)}


def _setting(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    try:
        return None if row is None else json.loads(row[0])
    except (TypeError, ValueError):
        return None


def _rename(source: Path, target: Path) -> bool:
    """Move a folder or a file to a place that is not there: whether it moved."""
    if not os.path.lexists(source) or os.path.lexists(target):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return True


def _homes(root: Path, slime: int) -> None:
    for folder in ("bots", "bot-state"):
        _rename(root / folder / "0", root / folder / str(slime))


def _cover(root: Path, slime: int) -> None:
    folder = root / "avatars" / "covers"
    metadata = folder / "0.json"
    if not metadata.is_file() or (folder / f"{slime}.json").exists():
        return
    document = json.loads(metadata.read_text(encoding="utf-8"))
    name = document.get("file") if isinstance(document, dict) else None
    if isinstance(name, str) and name.startswith("0-"):
        renamed = f"{slime}-{name[2:]}"
        if (folder / name).is_file() and not (folder / renamed).exists():
            (folder / name).rename(folder / renamed)
        if (folder / renamed).is_file():  # also when a start that stopped after the rename left the old JSON behind
            document["file"] = renamed
    (folder / f"{slime}.json").write_text(json.dumps(document), encoding="utf-8")
    metadata.unlink()


def _picture(conn, root: Path, slime: int) -> None:
    """The picture the owner uploaded for member 0: schema 101 named it `file:<slime>-<rest>`, its file is `0-<rest>`."""
    row = conn.execute("SELECT avatar FROM members WHERE id = ?", (slime,)).fetchone()
    kind, _, name = (row[0] if row else "").partition(":")
    if kind == "file" and name.startswith(f"{slime}-"):
        folder = root / "avatars" / "members"
        _rename(folder / f"0-{name[len(str(slime)) + 1:]}", folder / name)


def _messaging(data_dir: Path, vault, slime: int) -> None:
    path = data_dir / "messaging.json"
    if not path.is_file() or vault is None:
        return
    document = json.loads(path.read_text(encoding="utf-8"))
    channels = document.get("channels") if isinstance(document, dict) else None
    if not isinstance(channels, dict):
        return
    moved = []
    for platform in PLATFORMS:
        account = f"member:{slime}:{platform}"
        if platform not in channels or account in channels:
            continue
        for name in SECRETS[platform]:
            value = vault.get(f"messaging:{platform}:{name}")
            if value:
                vault.set(f"messaging:{account}:{name}", value)
        channels[account] = channels.pop(platform)
        moved.append(platform)
    if not moved:
        return
    temporary = path.with_name(path.name + ".part")
    temporary.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
    for platform in moved:  # only once the config names the new account: the old secrets are no one's now
        for name in SECRETS[platform]:
            vault.delete(f"messaging:{platform}:{name}")


def _computer(vm, slime: int) -> None:
    old, new = vm.key_for("", 0), vm.key_for("", slime)
    _rename(vm.homes / old, vm.homes / new)
    folder = vm.shared_members_folder()
    _rename(folder / old, folder / new)


def adopt(conn, *, root: Path, data_dir: Path, vault=None, vm=None) -> None:
    """Run the steps for the slime schema 101 made, once. `root` is the local folder (`bots`, `avatars` are in it)."""
    split = _setting(conn, "raphael_split")
    slime = split.get("slime") if isinstance(split, dict) else None
    if type(slime) is not int or slime <= 0 or _setting(conn, DONE_KEY) is True:
        return
    failed = False
    for name, step in (("memory", lambda: _homes(root, slime)), ("cover", lambda: _cover(root, slime)),
                       ("picture", lambda: _picture(conn, root, slime)),
                       ("messaging", lambda: _messaging(data_dir, vault, slime)),
                       ("computer", lambda: _computer(vm, slime) if vm is not None else None)):
        try:
            step()
        except Exception as exc:  # noqa: BLE001 - a step that fails is tried again at the next start
            failed = True
            logger.warning("Moving a former member 0's %s failed: %s", name, type(exc).__name__)
    if not failed:
        with conn:
            conn.execute("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", (DONE_KEY,))
