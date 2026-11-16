"""Slime faces that were renamed, and the one function that carries a stored or arriving id to its current name.

A member's face is `slime:<id>` (`slime:<id>:<tail>` in the first builds, where the tail is ignored); a catalogue entry
names its face by the bare `<id>`. Twenty-four faces were renamed to say what they look like. The old ids are kept
here only as SHA-256 digests, so nothing in the repository spells them: a stored id is hashed and looked up. The app has
its own copy of the table (`app/src/main/slime-ids.ts`); a test holds the two equal.

Every place an id can arrive from outside goes through `current_avatar` or `current_id`: a member written by the
chat's tools or a client, a catalogue entry (cached ones too), and the database migration that rewrote the stored ones.
"""
from __future__ import annotations

import hashlib

# sha256(retired id) -> the id the face has now.
RETIRED: dict[str, str] = {
    "ef8e0d4de84e5a576c88f69049af41c93c27a59455089b2b69e9c4c3767ec00a": "blue-plain",
    "dd2d8c67929c0f9ff86e7cdd37a65efe4cf07bbf94f2b2703efb47340dc00cd8": "horn-lavender",
    "8c649a8f85f3d89d4eba2cf885e7f9273c9672b73eaf3ce43c5ea038ca648f0f": "streaks-charcoal",
    "a89526be62a24aa308ea85d04225e1568bb9a5cbc64d140d88608439187463d0": "horns-red",
    "3809eaefc6e3c5d67af829d39a09acc271cd4fcef4c4c8abdd28b2d846e7993e": "small-horns-pink",
    "64e3541b3b2483dd0eaf9c51e8aff4f5aa36a1567369eed67eca041bed80ddb2": "horn-sash-blue",
    "304544a979deb561ff2114943f9d3673cfe3fdb35ee59b45e407c5f5ddb6580e": "mustache-gray",
    "2873be4655e5ea947eedd3fb774cb18980403eb9cc4f358b7e8dbbe9cbad1c86": "goggles-green",
    "0500be407557a859fd7ddc4d0b7e099200d36f770b9d06176a62496564aa3a17": "cap-green",
    "8491791106f1faf0f9d07aafb377bf57cb0622a7b049fefffcc4cbefe72f99cb": "bowtie-green",
    "c2b2cee73ea10377f07c4899069cf1ec6448d5b952cf10edb6372e128f9b2923": "tuft-pink",
    "bf618dab305c69ea27212ab85cc79fbd345d891c266277c826d6c3611e65b9f9": "horns-blue",
    "0e1b1d99008708e06880fa6dacbc82038d03d47b7d372d51adb92b6c2fd77ec8": "wolf-star",
    "348d1d93a5134abac6b29dff548f3d4f73e4aeb0e2a57de1cee78e511b927d3c": "frill-periwinkle",
    "086325a3ff8409072bbbfbcb478e974c5240d29dceedd7175ae69cb6f2595076": "tusks-tan",
    "7e00043caa7b2838de345435465c30a516ec7e2a68499842b12876f5ac578668": "sprout-mint",
    "51e83e5669dd835a2f18ec7929d396a516c6f8840a7cc27f927e28ab046d45c4": "headband-brown",
    "24fff5ac76bc4bd7dfd05147ff0a345c24436b59d83f6909eb7ee42c30ec6bda": "mask-cornflower",
    "3000caca5b94c7e5fc0f9e2f187bb589f925597778832ad59485280ac32be4c1": "collar-indigo",
    "3379feb6ae9fed3b989470c591c5aa7ec00269580b84f1737c9e63202645e4b2": "sash-crimson",
    "363554e2e3d91266fbc6000cffb52f8d33b38aeccf47698e87fb465bd150937d": "bowtie-pearl",
    "3f4aba76661a2088d9f97598515cfc9350da9005fc3c6e2a179e18f6c0c19751": "bowtie-purple",
    "9e334420f8c18aa18343c5178448e91b302147a4bcfae6e8178f1e15e4bc481f": "necktie-amber",
    "bc7f3b64af0ed4bbea4497ae5823c2216a973e46f5b43d5fc68b85c3bdf793a6": "wings-yellow",
}

# Costumes of the first builds that later became characters. They are plain words, so they are kept as they are.
LEGACY: dict[str, str] = {"oni": "horn-lavender", "demon": "streaks-charcoal"}


def current_id(slime_id: str) -> str:
    """The id a face has now: a retired id (or an old costume name) is renamed, any other comes back as it was."""
    if slime_id in LEGACY:
        return LEGACY[slime_id]
    return RETIRED.get(hashlib.sha256(slime_id.encode()).hexdigest(), slime_id)


def current_avatar(avatar: str) -> str:
    """`avatar` with its slime id renamed when it is a retired one; a picture, a plain colour or an unknown id is left alone.

    The id is the part after `slime:` up to the next colon, as the app reads it; the tail stays as it was.
    """
    if not isinstance(avatar, str) or not avatar.startswith("slime:"):
        return avatar
    first, colon, tail = avatar[6:].partition(":")
    renamed = current_id(first)
    return avatar if renamed == first else f"slime:{renamed}{colon}{tail}"
