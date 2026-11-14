"""Public words for structured receipts, shared by history and every text consumer."""
from raphael_core.ui_words import ui_word, with_ui_words
import json


def event_text(text):
    try:
        event = json.loads(text)
    except (ValueError, TypeError):
        return text
    if not isinstance(event, dict) or event.get("type") not in ("routine", "calendar", "meeting", "skill_learned", "job_set", "renamed", "computer_woke"):
        if isinstance(event, dict) and event.get("type") == "action":
            return ""
        return text
    if isinstance(event.get("text"), str):
        return event["text"]
    name = event.get("name")
    return name if isinstance(name, str) else ""


def event_record(name, data, language):
    if name.startswith("routine_"):
        item = data["routine"]
        event = {"type": "routine", "action": {"routine_create": "created", "routine_update": "updated", "routine_delete": "deleted"}[name],
                 "id": item["id"], "name": item["title"], "member_id": item["member_id"],
                 "text": _routine_line(name, data, language)}
    else:
        item = data["event"]
        event = {"type": "calendar", "action": {"calendar_add": "created", "calendar_update": "updated", "calendar_delete": "deleted"}[name],
                 "id": item["id"], "name": item["title"], "date": item["start"][:10],
                 "text": _calendar_line(name, data, language)}
    return json.dumps(event, ensure_ascii=False)


def _routine_line(name: str, data: dict, language: str) -> str:
    from ..ui_languages import fixed_language
    language = fixed_language(language)
    routine = data.get("routine", {})
    schedule = routine.get("schedule") or {}
    words = with_ui_words({"zh-TW": ("已建立例行任務", "已更新例行任務", "已刪除例行任務", "每天", "每週", "每小時"), "en": ("Routine created", "Routine updated", "Routine deleted", "Daily", "Weekly", "Every hour"), "ja": ("定期タスクを作成しました", "定期タスクを更新しました", "定期タスクを削除しました", "毎日", "毎週", "毎時")})[language]
    action = words[0 if name == "routine_create" else 1 if name == "routine_update" else 2]
    kind = schedule.get("kind")
    if routine.get("when") == {"webhook": True}:
        timing = with_ui_words({"zh-TW": "Webhook 收到 POST", "en": "When a webhook receives POST", "ja": "Webhook が POST を受信"})[language]
    elif when := routine.get("when"):
        app = routine.get("app_name") or when["app"]
        condition = f"{when['filter']['field']} = {when['filter']['equals']}"
        timing = with_ui_words({"zh-TW": f"當 {app} 有符合 {condition} 的新項目", "en": f"When {app} has a new item matching {condition}", "ja": f"{app} に {condition} と一致する新しい項目があるとき"}, lambda _ui_language: ui_word('When {p0} has a new item matching {p1}', _ui_language).format(p0=app, p1=condition))[language]
        if not when["filter"]["field"]:
            timing = with_ui_words({"zh-TW": f"當 {app} 有新項目", "en": f"When {app} has a new item", "ja": f"{app} に新しい項目があるとき"}, lambda _ui_language: ui_word('When {p0} has a new item', _ui_language).format(p0=app))[language]
    elif kind == "once":
        once = with_ui_words({"zh-TW": "一次", "ja": "一度", "en": "Once"})[language]
        timing = f"{once} · {schedule.get('start_date', '')} {schedule.get('time', '')}"
    elif kind == "weekdays":
        weekdays = with_ui_words({"zh-TW": "平日", "ja": "平日", "en": "Weekdays at"})[language]
        timing = f"{weekdays} {schedule.get('time', '')}"
    elif kind == "weekly":
        days = schedule.get("days", [])
        names = with_ui_words({"zh-TW": tuple("週" + day for day in "日一二三四五六"), "ja": "日月火水木金土", "en": ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")})[language]
        joiner = with_ui_words({"zh-TW": "、", "ja": "・", "en": ", "})[language]
        prefix = "每" if language in ("zh-TW", "zh-CN") else words[4] + ("" if language == "ja" else " ")
        timing = prefix + joiner.join(names[day] for day in sorted(set(days))) + " " + str(schedule.get("time", ""))
    elif kind == "monthly":
        day, time = schedule.get("day", 1), schedule.get("time", "")
        timing = with_ui_words({"zh-TW": f"每月 {day} 日 {time}", "en": f"Monthly on day {day} at {time}", "ja": f"毎月 {day} 日 {time}"}, lambda _ui_language: ui_word('Monthly on day {p0} at {p1}', _ui_language).format(p0=day, p1=time))[language]
    elif kind == "every":
        hours = schedule.get("hours", 1)
        timing = with_ui_words({"zh-TW": f"每 {hours} 小時", "ja": f"{hours}時間ごと", "en": "Every hour" if hours == 1 else f"Every {hours} hours"}, lambda _ui_language: ui_word('Every hour', _ui_language) if hours == 1 else ui_word('Every {p0} hours', _ui_language).format(p0=hours))[language]
        if minutes := schedule.get("minutes"):
            timing = with_ui_words({"zh-TW": f"每 {minutes} 分鐘", "en": f"Every {minutes} minutes", "ja": f"{minutes}分ごと"}, lambda _ui_language: ui_word('Every {p0} minutes', _ui_language).format(p0=minutes))[language]
        if schedule.get("from"):
            timing += f" · {schedule['from']}–{schedule['to']}"
    else:
        timing = words[3] + " " + str(schedule.get("time", ""))
    if schedule:
        if kind != "once" and (start := schedule.get("start_date")):
            timing += with_ui_words({"zh-TW": f" · 自 {start} 起", "ja": f" · {start}から", "en": f" · from {start}"}, lambda _ui_language: ui_word(' · from {p0}', _ui_language).format(p0=start))[language]
        if until := schedule.get("until"):
            timing += with_ui_words({"zh-TW": f" · 至 {until}", "ja": f" · {until}まで", "en": f" · until {until}"}, lambda _ui_language: ui_word(' · until {p0}', _ui_language).format(p0=until))[language]
        if (runs := schedule.get("max_runs")) is not None:
            timing += with_ui_words({"zh-TW": f" · 最多 {runs} 次", "ja": f" · 最大{runs}回", "en": f" · at most {runs} {'run' if runs == 1 else 'runs'}"}, lambda _ui_language: ui_word(' · at most {p0} {p1}', _ui_language).format(p0=runs, p1=ui_word('run' if runs == 1 else 'runs', _ui_language)))[language]
    return action if not routine else f"{action} · {timing.strip()} {routine.get('title', '')}"


def _calendar_line(name: str, data: dict, language: str) -> str:
    """The line a calendar change leaves in the conversation, as a routine's does."""
    from ..ui_languages import fixed_language
    language = fixed_language(language)
    event = data["event"]
    words = with_ui_words({"zh-TW": ("已加入行程", "已更新行程", "已刪除行程", "全天"), "en": ("Added to the calendar", "Calendar updated", "Removed from the calendar", "All day"),
             "ja": ("予定を追加しました", "予定を更新しました", "予定を削除しました", "終日")})[language]
    action = words[("calendar_add", "calendar_update", "calendar_delete").index(name)]
    day = event["start"][5:10].replace("-", "/")
    return f"{action} · {day} {words[3] if event['all_day'] else event['start'][11:16]} {event['title']}"
