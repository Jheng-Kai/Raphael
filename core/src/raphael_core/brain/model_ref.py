"""API model identity and optional reasoning choice; CLI references have their own parser."""

EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")


def split_api_ref(reference: str) -> tuple[str, str | None]:
    if reference.startswith("cli:"):
        return reference, None
    model, separator, effort = reference.partition("?effort=")
    if separator and (not model or effort not in EFFORTS):
        raise ValueError("Invalid model reasoning effort")
    return model.removeprefix("@openrouter:"), effort if separator else None


def api_ref(reference: str) -> str:
    model, effort = split_api_ref(reference)
    return model + (f"?effort={effort}" if effort is not None else "")
