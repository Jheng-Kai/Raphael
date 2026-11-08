"""Cua stdio MCP client with bounded ping, schema and control handling.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.

The trusted caller supplies the approval gate. No standalone unauthenticated proxy
or model loop is created here. Writes are serialized and calls refused during a hold.
"""

import asyncio
import json

from .. import __version__
from .vm import DRIVER, SOCKET, VmError, exec_args
from .desktop_host import NO_WINDOW
from .vm_catalog import SCREEN_READS


def normalize_schema(value):
    if not isinstance(value, dict):
        return {"type": "object", "properties": {}}
    kind = value.get("type", "object")
    if kind != "object" and not (isinstance(kind, list) and "object" in kind):
        return {"type": "object", "properties": {}}

    def shape(schema):
        properties = dict(schema.get("properties") or {})
        required = set(schema.get("required") or [])
        for branch in schema.get("allOf", []):
            child, needs = shape(branch)
            properties.update({k: v for k, v in child.items() if k not in properties})
            required.update(needs)
        for keyword in ("anyOf", "oneOf"):
            branches = [shape(branch) for branch in schema.get(keyword, [])]
            for child, _ in branches:
                properties.update({k: v for k, v in child.items() if k not in properties})
            if branches:
                required.update(set.intersection(*(needs for _, needs in branches)))
        return properties, required

    properties, required = shape(value)
    result = {key: item for key, item in value.items() if key not in ("$schema", "$id", "anyOf", "oneOf", "allOf", "not", "required")}
    result.update(type="object", properties=properties)
    if required:
        result["required"] = sorted(required & properties.keys())
    return result


class CuaBridge:
    read_timeout_s = 120.0
    action_timeout_s = 60.0

    def __init__(self, vm, target):
        self.vm, self.target = vm, target
        self.process = None
        self.sequence = 0
        self.lock = asyncio.Lock()
        self.pending = {}
        self.reader = None

    @property
    def alive(self):
        return self.process is not None and self.process.returncode is None

    async def __aenter__(self):
        self.process = await asyncio.create_subprocess_exec(
            *await self.vm.bridge_command(self.target, exec_args(self.target, [DRIVER, "mcp", "--socket", SOCKET], interactive=True)),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=16 * 1024 * 1024, creationflags=NO_WINDOW,
        )
        try:
            await self.request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                "clientInfo": {"name": "Raphael", "version": __version__}})
            await self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})
            return self
        except BaseException:
            await self.__aexit__(None, None, None)
            raise

    async def __aexit__(self, *exc):
        if self.reader:
            self.reader.cancel()
            await asyncio.gather(self.reader, return_exceptions=True)
            self.reader = None
        for future in self.pending.values():
            if not future.done():
                future.set_exception(ConnectionError("Driver closed"))
        self.pending.clear()
        if self.process:
            if self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
            self.process = None

    async def _write(self, packet):
        self.process.stdin.write(json.dumps(packet).encode() + b"\n")
        await self.process.stdin.drain()

    async def request(self, method, params=None, *, owner_observation=False):
        if method == "ping":
            return {}
        observing = owner_observation and method == "tools/call" and params in (
            {"name": "get_desktop_state", "arguments": {}}, {"name": "get_accessibility_tree", "arguments": {}})
        if method == "tools/call" and self.target.key in self.vm.held and not observing:
            return {"content": [{"type": "text", "text": "owner_holds_control"}], "isError": True}
        self.sequence += 1
        identifier = self.sequence
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        reading = method == "tools/call" and (params or {}).get("name") in SCREEN_READS
        timeout = self.read_timeout_s if reading else self.action_timeout_s
        try:
            async with asyncio.timeout(timeout):
                async with self.lock:
                    if method == "tools/call" and self.target.key in self.vm.held and not observing:
                        return {"content": [{"type": "text", "text": "owner_holds_control"}], "isError": True}
                    await self._write({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params or {}})
                if self.reader is None or self.reader.done():
                    self.reader = asyncio.create_task(self._read())
                result = await future
            if method == "tools/list":
                for tool in result.get("tools", []):
                    tool["originalInputSchema"] = tool.get("inputSchema") or {"type": "object"}
                    tool["inputSchema"] = normalize_schema(tool.get("inputSchema") or {"type": "object"})
            if result.get("isError"):
                result["content"] = [block for block in result.get("content", []) if block.get("type") == "text"]
            return result
        except (TimeoutError, asyncio.CancelledError):
            self.vm.invalidate(self.target)
            # Closing this owned connection abandons uncertain input; it must never be replayed.
            await self.__aexit__(None, None, None)
            raise
        except (VmError, ConnectionError):
            self.vm.invalidate(self.target)
            raise
        finally:
            self.pending.pop(identifier, None)

    async def _read(self):
        try:
            while any(not future.done() for future in self.pending.values()):
                line = await self.process.stdout.readline()
                if not line:
                    raise VmError("transport_closed")
                try:
                    packet = json.loads(line)
                except ValueError:
                    raise VmError("protocol") from None
                if "method" in packet:
                    if "id" in packet:
                        reply = {"result": {}} if packet["method"] == "ping" else {"error": {"code": -32601, "message": "Unsupported method"}}
                        async with self.lock:
                            await self._write({"jsonrpc": "2.0", "id": packet["id"], **reply})
                    continue
                future = self.pending.get(packet.get("id"))
                if future is None or future.done():
                    continue
                if not isinstance(packet.get("result"), dict):
                    raise VmError("protocol")
                future.set_result(packet["result"])
        except Exception as error:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(error)
