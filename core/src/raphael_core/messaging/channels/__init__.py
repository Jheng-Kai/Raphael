"""The messaging apps Raphael can be reached through."""

from .base import ChannelType
from .telegram import TELEGRAM
from .slack import SLACK
from .discord import DISCORD

CHANNEL_TYPES: dict[str, ChannelType] = {item.kind: item for item in (TELEGRAM, SLACK, DISCORD)}
