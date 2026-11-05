"""Local first-message suggestions; no provider request and no invented owner context."""

WORDS = {
    "zh-TW": ("請幫我達成{role}的目標，先和我確認成果。", "請協助我用{app}整理工作，先和我確認想達成的成果。", "我們先一起訂一個工作目標。"),
    "en": ("Help me reach a goal in {role}; first clarify the outcome with me.", "Help me organize my work in {app}; first clarify the outcome with me.", "Let's agree on a work goal together."),
    "ja": ("{role}の目標達成を手伝ってください。まず成果を一緒に確認しましょう。", "{app}で仕事を整理してください。まず目指す成果を確認しましょう。", "一緒に仕事の目標を決めましょう。"),
}


def choices(role, connections, language):
    role_line, app_line, general = WORDS[language]
    result = [role_line.format(role=role[:80])] if role else []
    result += [app_line.format(app=c["name"][:80]) for c in connections
               if c.get("enabled") and c.get("state") == "ready" and isinstance(c.get("name"), str)][:3 - len(result)]
    return result + [general]
