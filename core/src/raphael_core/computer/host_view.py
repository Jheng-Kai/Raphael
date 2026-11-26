"""Tab-scoped screencast and input for a DesktopViewer lease."""

import asyncio
import json
import math
from contextlib import suppress


class Screencast:
    def __init__(self, browser, tab):
        self.browser, self.tab = browser, tab
        self.watchers = set()
        self.lock = asyncio.Lock()
        self.latest = None

    @staticmethod
    def offer(queue, frame):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(frame)

    def frame(self, params):
        if not self.watchers:
            return
        meta = params["metadata"]
        self.publish(params["data"], meta["deviceWidth"], meta["deviceHeight"])

    def publish(self, data, width, height):
        self.latest = image = json.dumps({"image": data, "target": self.tab.id,
                                          "width": width, "height": height}).encode() + b"\n"
        for queue in self.watchers:
            self.offer(queue, image)

    async def first_picture(self):
        # Starting a screencast on an already composed page can leave it quiet
        # indefinitely. A single screenshot primes it without periodic encoding.
        with suppress(ValueError, OSError, TimeoutError):
            async with asyncio.timeout(0.75):
                shot = await self.browser.command(self.tab, "Page.captureScreenshot",
                                                  {"format": "jpeg", "quality": 75, "fromSurface": True})
            if not self.latest and shot and shot.get("data"):
                self.publish(shot["data"], *self.tab.viewport)

    async def watch(self):
        queue = asyncio.Queue(maxsize=1)
        async with self.lock:
            first = not self.watchers
            self.watchers.add(queue)
            try:
                if first:
                    await self.browser.command(self.tab, "Page.startScreencast", {"format": "jpeg", "quality": 75})
                if not self.latest:
                    await self.first_picture()
                if self.latest:
                    self.offer(queue, self.latest)
            except BaseException:
                await self._unwatch(queue)
                raise
        return queue

    async def restart(self):
        """The tab is bound to another Chrome: a picture asked for is streamed from the page it shows there."""
        async with self.lock:
            self.latest = None
            if self.watchers:
                with suppress(ValueError, OSError, TimeoutError):
                    await self.browser.command(self.tab, "Page.startScreencast", {"format": "jpeg", "quality": 75})

    async def unwatch(self, queue):
        async with self.lock:
            await self._unwatch(queue)

    async def _unwatch(self, queue):
        self.watchers.discard(queue)
        if not self.watchers:
            self.latest = None
            with suppress(ValueError, OSError, TimeoutError):
                async with asyncio.timeout(2):
                    await self.browser.command(self.tab, "Page.stopScreencast")

    def close(self):
        self.latest = None
        for queue in self.watchers:
            self.offer(queue, None)


class HostInputGate:
    def __init__(self, browser, tab, allowed):
        self.browser, self.tab, self.allowed = browser, tab, allowed
        self.keys = {}
        self.buttons = {}

    async def dispatch(self, event):
        if not self.allowed() or not isinstance(event, dict):
            return False
        kind = event.get("type")
        modifiers = event.get("modifiers", 0)
        if type(modifiers) is not int or not 0 <= modifiers <= 15:
            return False
        if kind == "release":
            await self.release()
        elif kind == "text":
            value = event.get("text")
            if not isinstance(value, str) or len(value) > 8192:
                return False
            await self.command("Input.insertText", {"text": value})
        elif kind in ("keyDown", "keyUp"):
            key, code, virtual = (event.get(name) for name in ("key", "code", "virtual"))
            value = event.get("text", "")
            if (not all(isinstance(item, str) and len(item) <= 64 for item in (key, code, value))
                    or type(virtual) is not int or not 0 <= virtual <= 255):
                return False
            args = {"type": kind, "key": key, "code": code, "windowsVirtualKeyCode": virtual, "modifiers": modifiers}
            if kind == "keyDown":
                if value:
                    args["text"] = value
                else:
                    args["type"] = "rawKeyDown"
                self.keys[code] = {**args, "type": "keyUp", "modifiers": 0}
                self.keys[code].pop("text", None)
            else:
                self.keys.pop(code, None)
            await self.command("Input.dispatchKeyEvent", args)
        elif kind in ("mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"):
            args = {"type": kind, "modifiers": modifiers}
            for name in ("x", "y", "deltaX", "deltaY") if kind == "mouseWheel" else ("x", "y"):
                value = event.get(name)
                if type(value) not in (int, float) or not -100_000 <= value <= 100_000 or not math.isfinite(value):
                    return False
                args[name] = value
            buttons = event.get("buttons", 0)
            if type(buttons) is not int or not 0 <= buttons <= 31:
                return False
            args["buttons"] = buttons
            if kind in ("mousePressed", "mouseReleased"):
                button, count = event.get("button"), event.get("count")
                if button not in ("left", "middle", "right", "back", "forward") or type(count) is not int or not 1 <= count <= 3:
                    return False
                args.update(button=button, clickCount=count)
                if kind == "mousePressed":
                    self.buttons[button] = {**args, "type": "mouseReleased", "buttons": 0, "modifiers": 0}
                else:
                    self.buttons.pop(button, None)
            await self.command("Input.dispatchMouseEvent", args)
        else:
            return False
        return True

    async def command(self, method, args):
        async with asyncio.timeout(2):
            await self.browser.command(self.tab, method, args)

    async def release(self):
        keys, buttons = self.keys, self.buttons
        self.keys, self.buttons = {}, {}
        with suppress(ValueError, OSError, TimeoutError):
            async with asyncio.timeout(2):
                for method, events in (("Input.dispatchKeyEvent", keys), ("Input.dispatchMouseEvent", buttons)):
                    for args in events.values():
                        await self.command(method, args)
