"""Descriptive tool backend inventory, not another settings or credential store.

Selection remains owned by brain.settings. Rows with an outstanding integration are
still visible, including when their credentials or optional runtime are absent.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Backend:
    id: str
    name: str
    billing: str
    key_service: str = ""
    integration: str = "settings_required"
    key_optional: bool = False


SEARCH = (
    Backend("ddgs", "DuckDuckGo", "free"),
    Backend("exa-free", "Exa (public MCP)", "free"),
    Backend("parallel-free", "Parallel (public MCP)", "free"),
    Backend("keenable-free", "Keenable (public API)", "free"),
    Backend("tavily-free", "Tavily (keyless)", "free"),
    Backend("firecrawl-free", "Firecrawl (keyless)", "free"),
    Backend("firecrawl", "Firecrawl", "metered", "firecrawl"),
    Backend("firecrawl-selfhosted", "Firecrawl (self hosted)", "self_hosted", "firecrawl-selfhosted", key_optional=True),
    Backend("parallel", "Parallel", "metered", "parallel"),
    Backend("keenable", "Keenable", "metered", "keenable"),
    Backend("perplexity", "Perplexity Search", "metered", "perplexity"),
    Backend("xai", "xAI Grok Web Search", "metered", "xai"),
    Backend("openai-native", "OpenAI Codex Web Search", "subscription", integration="oauth_required"),
    Backend("nous", "Nous Subscription Web Search", "subscription", integration="oauth_required"),
    Backend("xai-oauth", "xAI Grok Web Search (OAuth)", "subscription", integration="oauth_required"),
)
READ = tuple(row for row in SEARCH if row.id not in ("ddgs", "xai", "xai-oauth", "openai-native", "nous")) + (
    Backend("exa", "Exa", "metered", "exa"),
    Backend("nous", "Nous Subscription Page Extraction", "subscription", integration="oauth_required"),
)
TRANSCRIPTION = (
    Backend("whisper", "Whisper (local faster-whisper)", "local"),
    *(Backend(id, name, "free_tier" if id == "groq" else "metered", id) for id, name in (
        ("openai", "OpenAI Transcription"), ("groq", "Groq Transcription"),
        ("xai", "xAI Transcription"), ("elevenlabs", "ElevenLabs Scribe"),
        ("mistral", "Mistral Voxtral Transcription"), ("deepinfra", "DeepInfra Transcription"),
    )),
    Backend("nous", "Nous Subscription Transcription", "subscription", integration="oauth_required"),
    Backend("xai-oauth", "xAI Transcription (OAuth)", "subscription", integration="oauth_required"),
)
IMAGE = tuple(Backend(id, name, "metered", id, "ready") for id, name in (
    ("fal", "FAL.ai Image Generation"), ("krea", "Krea Image Generation"),
    ("deepinfra", "DeepInfra Image Generation"), ("meta-ai", "Meta Model API Image Generation"),
)) + (
    Backend("openai-codex", "OpenAI Codex Image Generation", "subscription", integration="oauth_required"),
    Backend("nous", "Nous Subscription Image Generation", "subscription", integration="oauth_required"),
    Backend("xai-oauth", "xAI Image Generation (OAuth)", "subscription", integration="oauth_required"),
)
VIDEO = tuple(Backend(id, name, "metered", "openrouter-media" if id == "openrouter" else id, "ready") for id, name in (
    ("fal", "FAL.ai Video Generation"), ("deepinfra", "DeepInfra Video Generation"),
    ("openrouter", "OpenRouter Video Generation"),
)) + (Backend("nous", "Nous Subscription Video Generation", "subscription", integration="oauth_required"),
      Backend("xai-oauth", "xAI Video Generation (OAuth)", "subscription", integration="oauth_required"))
BROWSER = (
    Backend("local", "Local Chromium", "local", integration="computer_required"),
    Backend("lightpanda", "Lightpanda", "local", integration="computer_required"),
    *(Backend(id, name, "metered", id, "computer_required") for id, name in (
        ("browserbase", "Browserbase"), ("browser-use", "Browser Use Cloud"), ("firecrawl", "Firecrawl Browser"),
    )),
    Backend("nous", "Nous Subscription Browser", "subscription", integration="oauth_required"),
)
EXECUTION = (
    Backend("local", "Local Shell", "local", integration="computer_required"),
    Backend("docker", "Docker / Podman", "local", integration="computer_required"),
    Backend("ssh", "SSH", "self_hosted", integration="computer_required"),
    Backend("modal", "Modal", "metered", "modal-token-id", "computer_required"),
    Backend("daytona", "Daytona", "metered", "daytona", "computer_required"),
    Backend("vercel-sandbox", "Vercel Sandbox", "metered", "vercel", "computer_required"),
    Backend("nous-modal", "Nous Subscription Modal", "subscription", integration="oauth_required"),
)
GROUPS = {"search": SEARCH, "read": READ, "transcription": TRANSCRIPTION,
          "image": IMAGE, "video": VIDEO, "browser": BROWSER, "execution": EXECUTION,
          "x_search": (Backend("xai", "xAI X Search", "metered", "xai", "agent_required"),
                       Backend("xai-oauth", "xAI X Search (OAuth)", "subscription", integration="oauth_required"))}

# These toolsets have engines, permissions and data models, not interchangeable
# HTTP services. They remain visible without claiming an absent tool exists.
TOOLSETS = (
    ("file", "File Operations", "existing_engine"),
    ("code_execution", "Code Execution", "computer_required"),
    ("vision", "Vision / Image Analysis", "existing_engine"),
    ("video_analysis", "Video Analysis", "agent_required"),
    ("skills", "Skills", "existing_engine"),
    ("todo", "Task Planning", "existing_engine"),
    ("kanban", "Kanban Task Board", "missing"),
    ("memory", "Persistent Memory", "existing_engine"),
    ("context_engine", "Context Engine", "agent_required"),
    ("session_search", "Session Search", "existing_engine"),
    ("connections", "Connections", "existing_engine"),
    ("clarify", "Clarification", "existing_engine"),
    ("delegation", "Delegation", "existing_engine"),
    ("cronjob", "Scheduled Jobs", "existing_engine"),
    ("discord", "Discord", "integration_required"),
    ("discord_admin", "Discord Server Administration", "integration_required"),
    ("yuanbao", "Yuanbao", "missing"),
    ("computer_use", "cua-driver Computer Use", "existing_engine"),
)


def credential_service(service: str) -> str:
    """Free tiers never acquire a paid tier's stored key."""
    return "" if service.endswith("-free") else "openrouter-media" if service == "openrouter" else service
