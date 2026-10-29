"""Cua stdio MCP client, with OpenMausBot's ping/schema/control adaptations.

The trusted caller supplies the approval gate. No standalone unauthenticated proxy
or model loop is created here. All calls are serialized and refused during a hold.
"""

import asyncio
import json

from .vm import DRIVER, SOCKET, VmError, exec_args


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
    def __init__(self, vm, target):
        self.vm, self.target = vm, target
        self.process = None
        self.sequence = 0
        self.lock = asyncio.Lock()

    async def __aenter__(self):
        self.process = await asyncio.create_subprocess_exec(
            "docker", *exec_args(self.target, [DRIVER, "mcp", "--socket", SOCKET], interactive=True),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=16 * 1024 * 1024,
        )
        try:
            await self.request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                "clientInfo": {"name": "Raphael", "version": "0.3.0"}})
            await self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})
            return self
        except BaseException:
            await self.__aexit__(None, None, None)
            raise

    async def __aexit__(self, *exc):
        if self.process:
            if self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
            self.process = None

    async def _write(self, packet):
        self.process.stdin.write(json.dumps(packet).encode() + b"\n")
        await self.process.stdin.drain()

    async def request(self, method, params=None):
        if method == "ping":
            return {}
        async with self.lock:
            if method == "tools/call" and self.target.key in self.vm.held:
                return {"content": [{"type": "text", "text": "owner_holds_control"}], "isError": True}
            self.sequence += 1
            identifier = self.sequence
            async with asyncio.timeout(60):
                await self._write({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params or {}})
                while line := await self.process.stdout.readline():
                    try:
                        packet = json.loads(line)
                    except ValueError:
                        raise VmError("protocol") from None
                    if packet.get("method") == "ping":
                        if "id" in packet:
                            await self._write({"jsonrpc": "2.0", "id": packet["id"], "result": {}})
                        continue
                    if "method" in packet and "id" in packet:
                        await self._write({"jsonrpc": "2.0", "id": packet["id"], "error": {"code": -32601, "message": "Unsupported method"}})
                        continue
                    if packet.get("id") != identifier or "method" in packet:
                        continue
                    if not isinstance(packet.get("result"), dict):
                        raise VmError("protocol")
                    result = packet["result"]
                    if method == "tools/list":
                        for tool in result.get("tools", []):
                            tool["originalInputSchema"] = tool.get("inputSchema") or {"type": "object"}
                            tool["inputSchema"] = normalize_schema(tool.get("inputSchema") or {"type": "object"})
                    if result.get("isError"):
                        result["content"] = [block for block in result.get("content", []) if block.get("type") == "text"]
                    return result
            raise VmError("transport_closed")
