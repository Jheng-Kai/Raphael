"""The owner's standing computer permission, independent of the shared VM target."""

from ..clock import wall_clock_ms


class ComputerGrants:
    def __init__(self, conn=None):
        self.conn = conn
        self._states = {}

    def state(self, member_id):
        if self.conn is None:
            return self._states.get(member_id)
        row = self.conn.execute("SELECT granted FROM computer_grants WHERE member_id=?", (member_id,)).fetchone()
        return None if row is None else bool(row[0])

    def allowed(self, member_id):
        return self.state(member_id) is True

    def set(self, member_id, granted):
        if self.conn is None:
            self._states[member_id] = bool(granted)
        else:
            with self.conn:
                self.conn.execute(
                    "INSERT INTO computer_grants(member_id, granted, updated_at_ms) VALUES (?, ?, ?) "
                    "ON CONFLICT(member_id) DO UPDATE SET granted=excluded.granted, updated_at_ms=excluded.updated_at_ms",
                    (member_id, int(granted), wall_clock_ms()))


def refusal(language):
    return {
        "en": "Computer access is not granted. This routine cannot use the computer. Grant access in this member's private chat or press Start in its computer panel.",
        "zh-TW": "未取得電腦使用授權，此排程無法使用電腦。請在此成員的私人對話中授權，或按電腦面板的啟動。",
        "ja": "許可がないため、この定期実行はコンピューターを使用できません。このメンバーとの個別チャットで許可するか、パネルで起動してください。",
    }.get(language, "Computer access is not granted. This routine cannot use the computer.")


def request_question(language, member, reason):
    template = {
        "en": "Allow {member} to use the computer until you revoke access? {reason}",
        "zh-TW": "允許 {member} 使用電腦，直到你撤銷授權嗎？{reason}",
        "ja": "許可を取り消すまで、{member} にコンピューターの使用を許可しますか？{reason}",
    }.get(language, "Allow {member} to use the computer until you revoke access? {reason}")
    return template.format(member=member, reason=reason)
