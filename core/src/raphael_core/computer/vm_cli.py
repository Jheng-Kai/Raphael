"""Build or maintain the optional desktop with Docker; never starts the engine."""

import argparse
import asyncio
import json
from pathlib import Path

from .. import paths
from ..brain.db import connect
from ..brain.settings import SettingsStore
from .vm import LocalVm, VmError


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "status", "run", "start", "stop", "remove"))
    parser.add_argument("--data-dir", type=Path, default=paths.data_dir())
    parser.add_argument("--member", type=int, default=0)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    conn = connect(paths.db_path(args.data_dir))
    vm = LocalVm(args.data_dir, settings=SettingsStore(conn))
    try:
        target = vm.target(args.member)
        if args.action == "build":
            await vm.build()
        elif args.action in ("run", "start"):
            await vm.start(target)
        elif args.action in ("stop", "remove"):
            await vm.stop(target, remove=args.action == "remove")
        print(json.dumps(await vm.status(target)))
    except (VmError, OSError, TimeoutError) as error:
        print(json.dumps({"error": str(error) if isinstance(error, VmError) else type(error).__name__}))
        return 1
    finally:
        await vm.aclose()
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
