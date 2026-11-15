"""A folder this PC binds into a member's computer stays readable to its owner (owner, 2026-11-15, task 797).

On Windows, Python 3.12.4 and later give a folder made with mode 0o700 a DACL of its own, closed to anyone but the
account that made each file. The container engine makes the member's files as another account, so the owner could not read
the file a member made in the team folder, and the work that named it failed for want of it.
"""

import os
import subprocess

import pytest

from raphael_core.computer.vm import bound_folder

pytestmark = pytest.mark.skipif(os.name != "nt", reason="the folder access rules of Windows")


def inherits(path):
    shown = subprocess.run(["icacls", str(path)], capture_output=True, text=True, check=True).stdout
    return "(I)" in shown


def test_a_new_folder_takes_the_access_of_the_folder_it_is_in(tmp_path):
    folder = tmp_path / "team"
    bound_folder(folder)
    assert folder.is_dir() and inherits(folder)


def test_what_is_already_in_a_folder_stays(tmp_path):
    folder = tmp_path / "team"
    folder.mkdir()
    (folder / "plan.md").write_text("# Plan", encoding="utf8")
    bound_folder(folder)
    assert (folder / "plan.md").read_text(encoding="utf8") == "# Plan"
