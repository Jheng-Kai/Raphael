"""What the owner chose is what answers: nothing moves to another model or another bill by itself (R-MODEL-02)."""
import re
from pathlib import Path

import pytest

import raphael_core
from raphael_core.brain.settings import api_model, hosted_providers

SOURCE = Path(raphael_core.__file__).parent
# The only calls that may leave the chosen model, each for a reason the owner can see or the model itself imposes.
MAY_LEAVE = {
    ("agent/service.py", "search_model = api_model(self._settings, settings.model)"): "the search service the owner picked is OpenRouter's",
    ("agent/service.py", "ask, self._tools.web_search(ask.text, api_model(self._settings, settings.model), ledger)"): "the same search",
    ("brain/providers/registry.py", 'api_model(self.registry.settings, reference) if reference.startswith("cli:")'): "a CLI brain takes no API call",
}


def test_every_call_that_picks_a_model_for_api_work_names_the_services_it_may_reach():
    found = []
    for path in SOURCE.rglob("*.py"):
        rel = path.relative_to(SOURCE).as_posix()
        for line in path.read_text(encoding="utf-8").splitlines():
            if "api_model(" not in line or line.lstrip().startswith(("def ", "#", '"""')) or "api_providers=" in line:
                continue
            if not any(rel == where and text in line for where, text in MAY_LEAVE):
                found.append(f"{rel}: {line.strip()}")
    assert found == [], "a model reference would quietly become the auxiliary model"


class Settings:
    def __init__(self, **values):
        self.values = values

    def get(self, key):
        return self.values.get(key, "")


class Router:
    def api_providers(self):
        return {"openrouter", "mine"}


@pytest.mark.parametrize("chosen", ["@chatgpt:gpt-6.1-terra?effort=high", "@mine:big", "openai/gpt-6-sol"])
def test_a_model_on_a_service_stays_on_it(chosen):
    settings = Settings(assistant_model="openai/gpt-6-luna")
    assert api_model(settings, chosen, api_providers=hosted_providers(Router())) == chosen


def test_chatgpt_counts_before_the_router_knows_it_signed_in():
    assert "chatgpt" in hosted_providers(object())


def test_a_background_turn_keeps_the_members_model_whatever_it_is():
    text = (SOURCE / "background/service.py").read_text(encoding="utf-8")
    assert re.search(r"^\s*model = selected_model$", text, re.M)
    assert "api_model" not in text
