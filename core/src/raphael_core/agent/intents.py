"""Trusted panel actions carried beside, and separate from, the owner's visible words."""

from ..protocol import invalid_params

INTENTS = ("setup-telegram", "setup-slack", "setup-discord", "setup-docker", "share-template", "settings")
_CONNECT_APP = "connect-app:"


def app_slug(intent):
    if not isinstance(intent, str) or not intent.startswith(_CONNECT_APP):
        return None
    from ..connectors.service import _SLUG
    slug = intent.removeprefix(_CONNECT_APP)
    return slug if _SLUG.fullmatch(slug) else None


def checked(value, member_id):
    if value is not None and (not isinstance(value, str) or (value not in INTENTS and app_slug(value) is None)):
        raise invalid_params("intent must name a supported panel action")
    if value == "share-template" and member_id == 0:
        raise invalid_params("Raphael cannot share a member template")
    return value


def instruction(intent):
    if intent is None:
        return ""
    if slug := app_slug(intent):
        return (f'\n\n<panel_intent_step>Call connect_app with app "{slug}" now. Use its setup guide and links to '
                "explain what the card asks for and where to get it, step by step in plain words in the owner's language. "
                'Never ask for secret values in chat. If the Composio key is missing, call request_secret with connection: '
                '"composio" first, then call connect_app again after the owner saves it.</panel_intent_step>')
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
    if intent == "setup-docker":
        return ("\n\n<panel_intent_step>The owner asked for help installing Docker for a virtual machine. "
                "Read self_check's setup facts. Explain how to install Docker Desktop on this operating system "
                "with its official download link and ask the owner to open it once after installation. "
                "After installation the owner can return to the Computer panel or suggestion card.</panel_intent_step>")
    platform = intent.removeprefix("setup-")
    name = {"telegram": "Telegram", "slack": "Slack", "discord": "Discord"}[platform]
    return (f"\n\n<panel_intent_step>The owner pressed Set up for {name} on your panel. Call connect_messaging with platform {platform} now. "
            "Then follow the tool result: if already connected, say so and point to a waiting pairing card here, never ask for another token or explain creating a new bot. Only when a new token card is shown, briefly explain creating the bot and copying its token to that card; "
            "for Slack also the scopes im:read, im:history, chat:write, files:read, files:write. Approve or reject pairing in this conversation. The panel row has the switch and details; ask here for removal or disconnect, with owner approval. Never point to a messaging settings page or ask for the token in chat.</panel_intent_step>")
