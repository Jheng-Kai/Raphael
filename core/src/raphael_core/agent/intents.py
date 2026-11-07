"""Trusted panel actions carried beside, and separate from, the owner's visible words."""

from ..protocol import invalid_params

INTENTS = ("setup-telegram", "setup-slack", "setup-discord", "share-template", "settings")


def checked(value, member_id):
    if value is not None and (not isinstance(value, str) or value not in INTENTS):
        raise invalid_params("intent must name a supported panel action")
    if value == "share-template" and member_id == 0:
        raise invalid_params("Raphael cannot share a member template")
    return value


def instruction(intent):
    if intent is None:
        return ""
    if intent == "settings":
        return ("\n\n<panel_intent_step>The owner pressed Settings on your panel. In one short message in the owner's language, "
                "ask what to change and name what you can change for yourself here: your skills (import from a "
                "GitHub link or a skill link), your commands, what you remember about the work, your voice, and "
                "your name, job and picture. Then make each change with your own tools when the owner says, "
                "confirming what changed in one sentence. Permission changes are the owner's own: point them to "
                "the 權限 choice under the message box.</panel_intent_step>")
    if intent == "share-template":
        return ("\n\n<panel_intent_step>The owner pressed Share on your panel. Call share_template now with a short description "
                "(one or two sentences, the owner's language) of what you do for people, written for strangers: "
                "no names, private facts, keys, internal URLs or customer data. Then one short sentence.</panel_intent_step>")
    platform = intent.removeprefix("setup-")
    name = {"telegram": "Telegram", "slack": "Slack", "discord": "Discord"}[platform]
    return (f"\n\n<panel_intent_step>The owner pressed Set up for {name} on your panel. Call connect_messaging with platform {platform} now. "
            "Then, in one short message in the owner's language, say what the card needs (create the bot and copy its token; "
            "for Slack also the scopes im:read, im:history, chat:write, files:read, files:write). Never ask for the token in chat.</panel_intent_step>")
