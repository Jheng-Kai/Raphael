"""Driver 0.37.0 snapshot/ref/delivery behavior shared by vault transport doubles."""

from functools import wraps


def refused(ref):
    summary = f"refused (browser_ref_stale): ref {ref} is stale; re-run get_browser_state"
    return {"isError": False, "content": [{"type": "text", "text": summary}], "structuredContent": {
        "effect": "refused", "error": {"code": "browser_ref_stale", "hint": "Re-snapshot"},
        "escalation": {}, "hint": "Re-snapshot", "next_call": {}, "route": "trusted_input", "summary": summary}}


def measured(fields=("username", "password")):
    def decorate(request):
        @wraps(request)
        async def wrapped(self, method, params=None, *args, **kwargs):
            if method != "tools/call":
                return await request(self, method, params, *args, **kwargs)
            name, sent = params["name"], params["arguments"]
            if not hasattr(self, "semantic_pages"):
                self.semantic_pages, self.semantic_values, self.semantic_binds = {}, {}, {}
            key = sent.get("target_id"), sent.get("tab_id")
            if name == "browser_type":
                rows = self.semantic_pages.get(key, [])
                row = next((row for row in rows if row["ref"] == sent["ref"]), None)
                if row is None:
                    return refused(sent["ref"])
                reply = await request(self, method, params, *args, **kwargs)
                if reply.get("isError") or (reply.get("structuredContent") or {}).get("effect") == "refused":
                    return reply
                if "delivery" in (reply.get("structuredContent") or {}):
                    return reply
                old = self.semantic_values.get((key, row["name"]), row.get("value")) or ""
                self.semantic_values[key, row["name"]] = sent["text"] if sent.get("replace") else sent["text"] + old
                return {**reply, "structuredContent": {"effect": "unverifiable", "route": "trusted_input",
                    "delivery": {"delivered_count": len(sent["text"]), "mode": "background"}}}
            reply = await request(self, method, params, *args, **kwargs)
            if name != "get_browser_state" or reply.get("isError"):
                return reply
            page = reply.get("structuredContent") or {}
            tab = page.get("tab_id") or next((t.get("tab_id") for t in page.get("tabs", []) if t.get("active") is True), None)
            if "window_id" in sent:
                window = sent["window_id"]
                count = self.semantic_binds.get(window, 0)
                self.semantic_binds[window] = count + 1
                if count:
                    page["target_id"] += f"-bind{count}"
                    if tab:
                        new_tab = f"{tab}-bind{count}"
                        for entry in page.get("tabs", []):
                            if entry.get("tab_id") == tab:
                                entry["tab_id"] = new_tab
                        if page.get("tab_id"):
                            page["tab_id"] = new_tab
                        tab = new_tab
            if not tab:
                return reply
            if "target_id" in sent:
                page["tab_id"] = tab
                page.setdefault("page", {"url": next((entry.get("url") for entry in page.get("tabs", [])
                    if entry.get("active") is True), page.get("url"))})
            key = page.get("target_id"), tab
            generation = getattr(self, "semantic_generation", 0) + 1
            self.semantic_generation = generation
            order = list(fields) if generation % 2 else list(reversed(fields))
            rows = [dict(ref=f"p{generation}:{i}", frame="main", role="textbox", name=field,
                actions=["type", "pointer"], states={}, visibility="in_viewport",
                value=("••••" if field in ("password", "Secret") and self.semantic_values.get((key, field)) else self.semantic_values.get((key, field))))
                for i, field in enumerate(order, 1)]
            self.semantic_pages[key] = rows
            # The snapshot block as the driver answers it (0.37.0, measured on 2026-11-12).
            page.update(refs=rows, snapshot={"id": f"p{generation}", "complete": True, "continuation": None,
                "format": "semantic_v2", "scope": "viewport", "selected_nodes": len(rows), "total_nodes": len(rows)})
            return reply
        return wrapped
    return decorate


def member_ref(hub, target, identifier, field):
    tab = hub.page_tabs.get((target.key, identifier))
    return next((ref for ref, identity in hub.page_refs.get((target.key, identifier, tab), {}).items()
                 if identity[2] == field), "unknown-ref")
