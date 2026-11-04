"""Named DuckDB work through vm_exec.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.
Only the member workspace is used; no host data engine.
"""

import base64
import inspect
import json
import re
import shlex
import secrets
from pathlib import PurePosixPath

from ..agent.plugins import PluginResult

SCHEMA = {"type": "object", "properties": {
    "action": {"type": "string", "enum": ["import", "query", "chart", "list"]},
    "dataset": {"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]{0,47}$"},
    "table": {"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]{0,47}$"},
    "sources": {"type": "array", "minItems": 1, "maxItems": 20, "items": {"type": "string", "maxLength": 2000}, "description": "Workspace paths or attachment:<stored attachment ID>."},
    "sql": {"type": "string", "minLength": 1, "maxLength": 20000},
}, "required": ["action", "dataset"], "additionalProperties": False}
DEFINITION = {"description": "Keep a named dataset in your own computer between turns. Import workspace CSV, Excel (.xlsx) or Parquet files into a DuckDB table (multiple files union by column name), query SQL for a bounded table, list tables, or chart a two-column SELECT as an attachment. Use table to name an import. Dependencies install on first use in the workspace; no host access. Only use this on your independent computer, after its existing permission grant.", "parameters": SCHEMA}


def command_for(arguments):
    from . import dataset_runtime
    source = base64.b64encode(inspect.getsource(dataset_runtime).encode()).decode()
    data = base64.b64encode(json.dumps(arguments).encode()).decode()
    runner = ("import base64;exec(compile(base64.b64decode(" + repr(source) + "),'<dataset>','exec'))")
    # The bootstrap itself checks symlink containment before creating its private venv.
    bootstrap = """import fcntl,os,pathlib,subprocess,sys
root=pathlib.Path('/home/cua/workspace').resolve()
folder=root/'.raphael-data'
folder.mkdir(exist_ok=True)
if folder.resolve().parent != root: raise SystemExit('dataset path refused')
env=folder/'venv'
if env.exists() and env.resolve().parent != folder.resolve(): raise SystemExit('environment path refused')
python=env/'bin/python'
lock=folder/'install.lock'
if lock.is_symlink(): raise SystemExit('environment lock refused')
with lock.open('a') as held:
 fcntl.flock(held,fcntl.LOCK_EX)
 if not python.exists(): subprocess.run([sys.executable,'-m','venv',str(env)],check=True)
 check=subprocess.run([str(python),'-c','import duckdb,openpyxl'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if check.returncode: subprocess.run([str(python),'-m','pip','--disable-pip-version-check','install','duckdb==1.4.1','openpyxl==3.1.5'],check=True,stdout=sys.stderr)
os.execv(str(python),[str(python),'-c',RUNNER,DATA])
""".replace("RUNNER", repr(runner)).replace("DATA", repr(data))
    return "python3 -c " + shlex.quote(bootstrap)


async def run_dataset(arguments, call, store=None):
    from jsonschema import Draft202012Validator
    if not Draft202012Validator(SCHEMA).is_valid(arguments):
        return PluginResult(False, "bad_arguments")
    arguments = {**arguments, "sources": list(arguments.get("sources", []))}
    uploads = []
    for index, source in enumerate(arguments["sources"]):
        if source.startswith('attachment:'):
            try:
                path = store.path(source.removeprefix('attachment:'))
                if path.suffix.lower() not in ('.csv', '.xlsx', '.parquet'):
                    raise ValueError
                destination = f'.raphael-data/imports/{secrets.token_hex(16)}{path.suffix.lower()}'
                uploads.append((destination, path.read_bytes()))
                arguments['sources'][index] = destination
            except Exception:
                return PluginResult(False, 'bad_arguments')
    for source in arguments.get("sources", []):
        path = PurePosixPath(source)
        if ".." in path.parts or ":" in source or "\\" in source or path.is_absolute() and not source.startswith("/home/cua/workspace/") or path.suffix.lower() not in (".csv", ".xlsx", ".parquet"):
            return PluginResult(False, "bad_arguments")
    command = command_for(arguments)
    if len(command) > 16000:
        return PluginResult(False, 'bad_arguments', 'Use a shorter query or fewer sources per import.')
    for destination, data in uploads:
        for offset in range(0, max(len(data), 1), 6000):
            encoded = base64.b64encode(data[offset:offset + 6000]).decode()
            script = ("import base64,pathlib;root=pathlib.Path('/home/cua/workspace').resolve();"
                      f"path=root/{destination!r};"
                      "assert path.resolve().is_relative_to(root);path.parent.mkdir(parents=True,exist_ok=True);"
                      "assert path.resolve().is_relative_to(root);"
                      f"path.open({'wb' if offset == 0 else 'ab'!r}).write(base64.b64decode({encoded!r}))")
            uploaded = await call('vm_exec', {'command':'python3 -c ' + shlex.quote(script), 'timeout_seconds':60})
            if not uploaded.ok:
                return uploaded
            try:
                if json.loads(uploaded.text).get('exit_code', 0) != 0:
                    return PluginResult(False, 'tool_error', 'The attachment could not be copied into the member workspace.')
            except ValueError:
                return PluginResult(False, 'protocol')
    result = await call("vm_exec", {"command": command, "timeout_seconds": 1800})
    if not result.ok:
        return result
    try:
        process = json.loads(result.text)
        if process.get("exit_code", process.get("code", 0)) != 0:
            return PluginResult(False, "tool_error", "Dataset work failed in the member computer. Check the import, SQL or first-use dependency installation; no host operation was used.")
        # vm_exec concatenates stdout and stderr; first-use pip diagnostics follow our JSON stdout.
        data = json.loads(process.get("output", process.get("stdout", "{}")).splitlines()[0])
        if data.get("error"):
            return PluginResult(False, "tool_error", json.dumps(data))
        if path := data.pop("chart_path", None):
            attachment = await call("attach_file", {"path": path})
            return attachment
        return PluginResult(True, text=json.dumps(data, ensure_ascii=False))
    except (ValueError, TypeError, IndexError, AttributeError):
        return PluginResult(False, "protocol")
