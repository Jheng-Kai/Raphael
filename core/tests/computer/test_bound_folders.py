"""A folder this PC binds into a member's computer stays readable to its owner.

On Windows, Python 3.12.4 and later give a folder made with mode 0o700 a DACL of its own, closed to anyone but the
account that made each file. The container engine makes the member's files as another account, so the owner could not read
the file a member made in the team folder, and the work that named it failed for want of it.
"""

import os
from pathlib import Path

import pytest

from raphael_core.computer import vm
from raphael_core.computer.vm import bound_folder


@pytest.mark.parametrize(("system", "mode"), [("nt", None), ("posix", 0o700)])
def test_a_bound_folder_is_never_made_closed_on_windows(monkeypatch, tmp_path, system, mode):
    """The access a folder gets depends on the folder it is in, which differs from PC to PC; what the code decides is the
    mode it asks for: none on Windows, where 0o700 closes the folder and what the engine makes in it, 0o700 elsewhere."""
    made = []
    real = Path.mkdir
    monkeypatch.setattr(vm.os, "name", system)
    monkeypatch.setattr(Path, "mkdir", lambda self, *args, **kwargs: (made.append(kwargs.get("mode")), real(self, parents=True, exist_ok=True)))
    bound_folder(tmp_path / "team")
    assert made == [mode] and (tmp_path / "team").is_dir()


def test_what_is_already_in_a_folder_stays(tmp_path):
    folder = tmp_path / "team"
    folder.mkdir()
    (folder / "plan.md").write_text("# Plan", encoding="utf8")
    bound_folder(folder)
    assert (folder / "plan.md").read_text(encoding="utf8") == "# Plan"
