"""R-FILE-06: the files a command names are read where they are, so that one outside the work folder asks first.

A reading of the command's words and nothing more (it is no sandbox): what a command names outright is judged, what a
program it starts writes is not. The work folder here is a project; relative names are taken from it.
"""

import os

import pytest

from raphael_core import work_area
from raphael_core.computer.shell_writes import split, writes


@pytest.fixture
def folders(tmp_path):
    project, other = tmp_path / "project", tmp_path / "other"
    (project / "sub").mkdir(parents=True)
    other.mkdir()
    return project, other


def outside(folders, command, cwd=None, **more):
    project, other = folders
    posix = lambda path: path.as_posix()  # noqa: E731  (a slash is a separator on every system the tests run on)
    command = command.replace("{project}", posix(project)).replace("{other}", posix(other))
    return writes(command, str(cwd or project), [str(project)], home=str(project.parent / "home"), **more)


@pytest.mark.parametrize("command", [
    "Get-Process", "Get-ChildItem | Sort-Object Name", "git status", "python script.py", "npm install",
    "echo hello", "echo hi > out.txt", "echo hi >> sub/out.txt", "echo hi 2>&1", "dir > $null", "Write-Output 3 > nul",
    "Set-Content -Path {project}/a.txt -Value hello", "Out-File -FilePath {project}/sub/a.txt", "Add-Content a.txt 'x > y'",
    "Copy-Item a.txt b.txt", "Copy-Item C:/Windows/win.ini .", "cp /etc/hosts .", "Move-Item a.txt sub/a.txt",
    "mkdir sub2", "New-Item -Path . -Name z.txt -ItemType File", "rm *.tmp", "Remove-Item -Recurse -Force sub",
    "del /f /q a.txt", "ls | tee out.txt", "cd sub; echo x > y.txt", "Set-Location {project}; echo x > y.txt",
    "echo 'a > ../other/b'", 'echo "a > ../other/b"', "git clone https://example.invalid/r.git", "xcopy a b /s /y",
    "powershell -NoProfile -Command \"echo x > out.txt\"", "Get-Content a.txt | ForEach-Object { Set-Content b.txt $_ }",
    "Invoke-WebRequest https://example.invalid -OutFile page.html", "curl -o page.html https://example.invalid",
])
def test_a_command_that_names_only_files_in_the_work_folder_names_nothing_outside(folders, command):
    assert outside(folders, command) == [], command


@pytest.mark.parametrize("command", [
    "echo hi > {other}/x.txt", "echo hi >> ../other/x.txt", "echo hi 2> ../other/x.txt", "echo hi *> ../other/x.txt",
    "Get-ChildItem | Out-File -FilePath {other}/x.txt", "Set-Content {other}/a.txt hello", "Add-Content -LiteralPath ../other/a hi",
    "Copy-Item a.txt ../other/a.txt", "Copy-Item a.txt -Destination {other}", "cp a.txt ../other", "xcopy a ../other /s /y",
    "Move-Item a.txt ../other/a.txt", "mv ../other/a.txt .", "Remove-Item -Recurse -Force ../other", "rm ../other/*.tmp",
    "del /f /q ../other/a.txt", "Rename-Item ../other/a.txt b.txt", "mkdir ../evil", "md {other}/evil", "touch ../other/a",
    "New-Item -ItemType File -Path ../other -Name z.txt", "tee ../other/t.txt", "ls | tee {other}/t.txt",
    "Invoke-WebRequest https://example.invalid -OutFile ../other/z.zip", "iwr https://example.invalid -OutFile {other}/z",
    "curl -o ../other/z.zip https://example.invalid", "git clone https://example.invalid/r.git ../other/r",
    "cd ..; echo x > y.txt", "Set-Location ../other; Set-Content a.txt x", "pushd {other}; echo x > y.txt",
    "powershell -NoProfile -Command \"echo x > ../other/q.txt\"", "cmd /c \"echo x > ../other/q.txt\"",
    "Get-Content a.txt | ForEach-Object { Set-Content ../other/b.txt $_ }", "&{ echo x > ../other/k.txt }",
    "echo x > $env:USERPROFILE/a.txt", "echo x > %TEMP%/a.txt", "echo x > $(Get-Location)/../a.txt", "Set-Content $path hello",
    "echo a > ~/a.txt", "echo a > ~other/a.txt", "echo a > C:/Windows/a.txt",
])
def test_a_command_that_names_a_file_outside_the_work_folder_is_found(folders, command):
    assert outside(folders, command), command


def test_an_explicit_folder_for_the_command_decides_where_a_relative_name_is(folders):
    project, other = folders
    assert outside(folders, "echo x > out.txt") == []
    assert outside(folders, "echo x > out.txt", cwd=other) == ["out.txt"]
    assert outside(folders, "Get-ChildItem", cwd=other) == []  # a read names no file
    assert writes("echo x > out.txt", None, [str(project)]) == ["out.txt"]  # a folder it cannot name: asked
    assert writes("echo x > " + (project / "out.txt").as_posix(), None, [str(project)]) == []


def test_a_target_through_a_link_that_leads_out_is_outside(folders):
    from agent.test_owner_files import _link_folder
    project, other = folders
    _link_folder(project / "door", other)
    assert outside(folders, "echo x > door/a.txt") == ["door/a.txt"]
    assert outside(folders, "Remove-Item door/a.txt") == ["door/a.txt"]


@pytest.mark.skipif(os.name != "nt", reason="Windows' own path forms")
def test_a_long_or_device_form_of_a_path_is_judged_as_the_path_it_names(folders):
    project, other = folders
    assert outside(folders, "echo x > \\\\?\\" + str(project / "a.txt")) == []
    assert outside(folders, "echo x > \\\\?\\" + str(other / "a.txt")) != []
    for device in ("\\\\.\\pipe\\x", "\\\\?\\GLOBALROOT\\Device\\x", "NUL.txt", "CON"):
        assert outside(folders, "echo x > " + device) != [] or device.lower().startswith("nul"), device


def test_what_is_between_quotes_is_a_word_and_not_a_redirection():
    [segment] = split("echo 'a > b' \"c > d\" e", True)
    assert [token.text for token in segment] == ["echo", "a > b", "c > d", "e"] and not any(token.redirect for token in segment)
    [segment] = split("echo a 2>&1 > out.txt", True)
    assert [(token.text, token.redirect) for token in segment] == [("echo", False), ("a", False), (">", True), ("out.txt", False)]
    assert [token.dynamic for token in split("echo $HOME $null \"$x\" plain", True)[0]] == [False, True, False, True, False]


def test_a_shell_that_escapes_with_a_backslash_keeps_an_escaped_space_in_the_word():
    [segment] = split("cp a\\ b.txt dir > /dev/null", False)
    assert [token.text for token in segment if not token.redirect][:3] == ["cp", "a b.txt", "dir"]


def test_a_long_path_is_shown_with_its_start_and_its_file():
    path = "C:\\" + "folder\\" * 40 + "the-file.txt"
    shown = work_area.shown(path)
    assert len(shown) <= 150 and shown.startswith("C:\\folder") and shown.endswith("the-file.txt") and "…" in shown
    assert work_area.shown("C:\\short.txt") == "C:\\short.txt"
