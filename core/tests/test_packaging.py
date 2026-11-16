"""The release packaging scripts in core/packaging, without PyInstaller or a frozen build."""

import importlib.util
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PACKAGING = Path(__file__).resolve().parents[1] / "packaging"


def load_script(name: str):
    """Import core/packaging/<name>.py under a module name of its own."""
    spec = importlib.util.spec_from_file_location(f"raphael_packaging_{name}", PACKAGING / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def notices():
    return load_script("notices")


# The platforms the core is built on, as sys.platform names them: each has a source manifest of its own.
SYSTEMS = ("win32", "darwin")
# What the Windows manifest pins; the macOS one also pins the python-build-standalone release.
WINDOWS_PINS = {"python", "openssl", "expat", "libmpdec", "opencc", "soxr", "soundfile", "libsndfile"}


@pytest.fixture(scope="module", params=SYSTEMS)
def system(request):
    return request.param


@pytest.fixture(scope="module")
def manifest(notices, system):
    return notices.load_source_manifest(system)


def test_each_platform_has_its_own_source_manifest(notices):
    assert notices.SOURCE_MANIFESTS == {"win32": "sources.json", "darwin": "sources-macos.json"}
    assert notices.manifest_name("win32") == "sources.json"
    assert notices.manifest_name("darwin") == "sources-macos.json"
    # Any other platform keeps the Windows manifest, as before there was a macOS one.
    assert notices.manifest_name("linux") == "sources.json"


def test_every_pinned_license_text_is_listed_and_every_listed_text_matches_its_checksum(notices):
    manifests = [notices.load_source_manifest(system) for system in SYSTEMS]
    listed = {item["file"] for manifest in manifests for item in manifest["licenses"]}
    adapted = {name for name in notices.ADAPTED_LICENSE_FILES if name.endswith(".txt")}
    assert listed.isdisjoint(adapted)
    assert listed | adapted == {path.name for path in notices.LICENSES.glob("*.txt")}
    assert all((notices.LICENSES / name).is_file() for name in notices.ADAPTED_LICENSE_FILES)
    for item in (item for manifest in manifests for item in manifest["licenses"]):
        assert item["url"].startswith("https://"), item["file"]
        assert not re.search(r"/(?:main|master|HEAD)/", item["url"]), f"{item['file']} is not pinned to a version"
        assert re.fullmatch(r"[0-9a-f]{64}", item["sha256"]), item["file"]


def test_a_changed_license_text_is_refused(notices, system, manifest, monkeypatch, tmp_path):
    name = notices.manifest_name(system)
    for item in manifest["licenses"]:
        (tmp_path / item["file"]).write_bytes((notices.LICENSES / item["file"]).read_bytes())
    (tmp_path / name).write_bytes((notices.LICENSES / name).read_bytes())
    monkeypatch.setattr(notices, "LICENSES", tmp_path)
    assert notices.load_source_manifest(system)["licenses"]

    libffi = next(item["file"] for item in manifest["licenses"] if item["file"].startswith("libffi-"))
    (tmp_path / libffi).write_text("changed", encoding="utf-8")

    with pytest.raises(RuntimeError, match=re.escape(libffi)):
        notices.load_source_manifest(system)


def test_the_shipped_binary_components_have_notices(notices):
    manifest = notices.load_source_manifest("win32")
    components = {item["component"]: item for item in manifest["licenses"] if "component" in item}
    assert {"OpenSSL 3.5.8", "libffi 3.4.2", "Expat 2.8.3", "libmpdec 2.5.1", "marisa-trie 0.3.1"} <= set(components)
    # The binaries that carry them, so a reader can tell what each text is for.
    assert "libcrypto-3-x64.dll" in components["OpenSSL 3.5.8"]["shipped_in"]
    assert "libffi-8.dll" in components["libffi 3.4.2"]["shipped_in"]
    assert "pyexpat.pyd" in components["Expat 2.8.3"]["shipped_in"]
    assert "_decimal.pyd" in components["libmpdec 2.5.1"]["shipped_in"]
    assert components["marisa-trie 0.3.1"]["license"] == "BSD-2-Clause OR LGPL-2.1-or-later"


def test_the_macos_runtime_and_wheel_components_have_notices(notices):
    manifest = notices.load_source_manifest("darwin")
    components = {item["component"]: item for item in manifest["licenses"] if "component" in item}
    # python-build-standalone links these into libpython3.12.dylib instead of shipping DLLs and .pyd files.
    runtime = {"OpenSSL 3.5.8", "libffi 3.4.8", "Expat 2.8.4", "libmpdec 4.0.0", "bzip2 1.0.8",
               "liblzma (XZ Utils) 5.8.3", "SQLite 3.53.1"}
    assert runtime <= set(components)
    for name in runtime:
        assert components[name]["shipped_in"].startswith("libpython3.12.dylib, linked in statically"), name
    # The macOS build of libsndfile carries other codec versions than the Windows DLL.
    assert {"libsndfile 1.2.2", "libopus 1.4", "libogg 1.3.5", "libvorbis 1.3.7", "libFLAC 1.4.3", "LAME 3.100",
            "marisa-trie 0.3.1"} <= set(components)
    assert "_soundfile_data/libsndfile_arm64.dylib" in components["libsndfile 1.2.2"]["shipped_in"]
    assert "opencc_clib.cpython-312-darwin.so" in components["marisa-trie 0.3.1"]["shipped_in"]
    # Nothing in it names a Windows binary.
    text = json.dumps(manifest)
    assert not re.search(r"\.(?:dll|pyd)\b", text), re.findall(r"\S+\.(?:dll|pyd)\b", text)


def test_the_windows_manifest_names_no_macos_binary(notices):
    assert ".dylib" not in json.dumps(notices.load_source_manifest("win32"))


def test_the_pins_cover_every_version_the_texts_and_source_links_depend_on(notices, system, manifest):
    expected = WINDOWS_PINS | ({"python-build-standalone"} if system == "darwin" else set())
    assert set(manifest["pinned_versions"]) == expected
    if sys.platform in SYSTEMS:
        expected_here = WINDOWS_PINS | ({"python-build-standalone"} if sys.platform == "darwin" else set())
        assert set(notices.installed_versions()) == expected_here
    for item in manifest["licenses"]:
        if "component" in item:
            version = item["component"].rsplit(" ", 1)[1]
            assert version in item["file"], f"{item['file']} is not named after {item['component']}"


@pytest.mark.skipif(sys.platform != "darwin", reason="the macOS pins describe the macOS runtime and wheels")
def test_the_macos_pins_are_what_this_macos_environment_has(notices):
    assert notices.installed_versions() == notices.load_source_manifest()["pinned_versions"]


def test_the_python_build_standalone_release_is_read_from_the_build_file_uv_writes(notices, monkeypatch, tmp_path):
    monkeypatch.setattr(notices.sys, "base_prefix", str(tmp_path))
    assert notices.standalone_release() is None
    (tmp_path / "BUILD").write_text("20260901\n", encoding="utf-8")
    assert notices.standalone_release() == "20260901"


def test_a_build_with_other_versions_than_the_pins_is_refused(notices, system, manifest):
    pinned = manifest["pinned_versions"]
    name = notices.manifest_name(system)
    notices.check_pinned_versions(pinned, dict(pinned), name)

    with pytest.raises(RuntimeError, match=re.escape(f"licenses/{name} describes other versions than this build")):
        notices.check_pinned_versions(pinned, {**pinned, "openssl": "3.0.19"}, name)
    with pytest.raises(RuntimeError, match="openssl: pinned 3.5.8, installed 3.0.19; soxr: pinned 1.1.0, installed None"):
        notices.check_pinned_versions(pinned, {**pinned, "openssl": "3.0.19", "soxr": None}, name)


def test_the_notice_text_says_where_the_lgpl_source_is(notices, system, manifest):
    text = "\n".join(notices.component_sections(manifest, notices.manifest_name(system)))

    assert f"licenses/{notices.manifest_name(system)}" in text
    assert "## Source code of LGPL components" in text
    for fragment in (
        "libsoxr 0.1.3-14-ga66f3ee (LGPL-2.1-or-later)",
        "https://github.com/dofuuz/soxr/tree/a66f3eeeeb62a32403ff143b756eed92b1ec6b62",
        "soxr-1.1.0.tar.gz",
        "marisa-trie 0.3.1",
        "https://github.com/s-yata/marisa-trie/tree/3e87d53b78e15f2f43783d5e376561a8c9722051",
        "opencc-1.4.2.tar.gz",
    ):
        assert fragment in text
    for component in manifest["licenses"]:
        if "component" in component:
            assert f"upstream/{component['file']}" in text
    for item in manifest["source_code"]:
        for source in item["sources"]:
            assert source["url"].startswith("https://")
            assert re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", "0" * 64))


@pytest.fixture(scope="module")
def build():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(PACKAGING))  # build.py imports its sibling notices.py by name
        return load_script("build")


@pytest.fixture
def bundle(build, tmp_path):
    """A frozen core that has every required file and nothing else."""
    for name in build.required_files():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode())
    return tmp_path


def test_a_bundle_with_the_required_files_passes_the_audit(build, bundle):
    manifest = build.audit_bundle(bundle)

    assert {item["path"] for item in manifest["files"]} == set(build.required_files())


def test_the_audit_requires_every_pinned_license_text(build, bundle):
    # The libffi text of this platform's manifest: 3.4.2 on Windows, 3.4.8 on macOS.
    libffi = next(name for name in build.required_files() if name.startswith("_internal/licenses/upstream/libffi-"))
    (bundle / libffi).unlink()

    with pytest.raises(RuntimeError, match=re.escape(libffi.rsplit("/", 1)[1])):
        build.audit_bundle(bundle)


@pytest.mark.parametrize("system", SYSTEMS)
def test_the_audit_requires_the_license_texts_of_its_own_platform(build, notices, system):
    upstream = {name.rsplit("/", 1)[1] for name in build.required_files(system)
                if name.startswith("_internal/licenses/upstream/")}

    assert upstream == {item["file"] for item in notices.load_source_manifest(system)["licenses"]}


@pytest.mark.parametrize("name", ["NOTICES.md", "Apache-2.0.txt", "hermes-agent-MIT.txt", "OpenBot-MIT.txt"])
def test_the_audit_requires_every_adapted_code_notice(build, bundle, name):
    (bundle / "_internal" / "licenses" / name).unlink()
    with pytest.raises(RuntimeError, match=re.escape(name)):
        build.audit_bundle(bundle)


@pytest.fixture
def generated(notices, system, manifest, monkeypatch, tmp_path):
    """The notices write_notices generates for a platform, from fake distributions and a fake runtime."""
    packaging = tmp_path / "packaging"
    packaging.mkdir()
    monkeypatch.setattr(notices, "__file__", str(packaging / "notices.py"))
    monkeypatch.setattr(notices, "installed_versions", lambda: manifest["pinned_versions"])
    monkeypatch.setattr(notices, "runtime_distributions", lambda: [])
    monkeypatch.setattr(notices, "distribution", lambda name: SimpleNamespace(
        version="1", files=[], read_text=lambda filename: "test metadata",
    ))
    python = tmp_path / "python"
    monkeypatch.setattr(notices.sys, "base_prefix", str(python))
    # Beside python.exe on Windows; python-build-standalone keeps it in lib/python3.12 on macOS.
    license_file = notices.python_license(system)
    assert license_file.relative_to(python).as_posix() == (
        "lib/python3.12/LICENSE.txt" if system == "darwin" else "LICENSE.txt")
    license_file.parent.mkdir(parents=True)
    license_file.write_text("test Python license", encoding="utf-8")
    target = tmp_path / "build" / "notices"

    notices.write_notices(target, system)

    return target


def test_generated_notices_ship_adapted_code_texts_in_the_bundle_and_release_notice(notices, generated):
    text = (generated / "THIRD_PARTY_NOTICES.txt").read_text(encoding="utf-8")
    for name in notices.ADAPTED_LICENSE_FILES:
        assert (generated / name).read_bytes() == (notices.LICENSES / name).read_bytes()
        assert (notices.LICENSES / name).read_text(encoding="utf-8") in text
    assert "Copyright (c) 2025 CJ Pais" in text
    assert "Copyright (c) 2026 CopilotKit" in text
    assert (generated / "python" / "LICENSE.txt").read_text(encoding="utf-8") == "test Python license"


def test_generated_notices_ship_only_the_texts_of_their_own_platform(notices, system, manifest, generated):
    text = (generated / "THIRD_PARTY_NOTICES.txt").read_text(encoding="utf-8")
    upstream = {path.name for path in (generated / "upstream").iterdir()}
    own = notices.manifest_name(system)
    other = notices.manifest_name("win32" if system == "darwin" else "darwin")
    listed = {item["file"] for item in manifest["licenses"]}

    assert own in upstream and other not in upstream
    assert listed <= upstream
    assert upstream.isdisjoint(notices.other_platform_files(system))
    # Everything else in licenses/ still ships, as it did before there was a macOS manifest.
    assert upstream == {path.name for path in notices.LICENSES.iterdir()} - notices.other_platform_files(system)
    for item in manifest["licenses"]:
        assert f"upstream/{item['file']}" in text
    assert f"licenses/{own}" in text and f"licenses/{other}" not in text


def test_generated_notices_describe_the_binaries_of_their_platform(generated, system):
    text = (generated / "THIRD_PARTY_NOTICES.txt").read_text(encoding="utf-8")
    notice = text.split("\n" + "=" * 72, 1)[0]  # what Raphael wrote, before the copied license texts
    if system == "darwin":
        assert "python-build-standalone 20260901" in notice
        assert "libsndfile_arm64.dylib" in notice and "cmake/onnxruntime-osx-arm64.cmake" in notice
        assert not re.search(r"\b(?:DLLs?|\S+\.(?:dll|pyd))\b", notice), re.findall(r"\S+\.(?:dll|pyd)\b", notice)
    else:
        assert "sherpa-onnx-core installs its DLLs into sherpa_onnx/lib" in notice
        assert "libsndfile_x64.dll" in notice and "cmake/onnxruntime-win-x64.cmake" in notice
        assert ".dylib" not in notice


def test_the_audit_requires_the_shared_catalog_search_data(build, bundle):
    (bundle / "_internal/raphael_core/connectors/finder-data.json").unlink()
    with pytest.raises(RuntimeError, match="finder-data.json"):
        build.audit_bundle(bundle)


@pytest.mark.parametrize("name", [
    "_internal/opencc/clib/bin/opencc.exe",
    "_internal/opencc/clib/bin/opencc_dict.exe",
    "_internal/opencc/clib/include/opencc/opencc.h",
    "_internal/opencc/clib/include/opencc/Common.hpp",
    "_internal/opencc/clib/lib/opencc.lib",
    "_internal/opencc/clib/lib/marisa.lib",
    "_internal/opencc/clib/lib/cmake/opencc/OpenCCConfig.cmake",
    "_internal/opencc/clib/lib/pkgconfig/opencc.pc",
    "_internal/numpy/_core/_multiarray_tests.cp312-win_amd64.pyd",
    "_internal/numpy/_core/_umath_tests.cp312-win_amd64.pyd",
    "_internal/other/tool.exe",
])
def test_the_audit_refuses_build_tooling_and_test_helpers(build, bundle, name):
    path = bundle / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")

    with pytest.raises(RuntimeError, match="Build tooling or test helper in bundle"):
        build.audit_bundle(bundle)


@pytest.mark.parametrize("name", [
    "_internal/opencc/clib/opencc_clib.cp312-win_amd64.pyd",
    "_internal/opencc/clib/share/opencc/s2twp.json",
    "_internal/opencc/clib/share/opencc/STPhrases.ocd2",
    "_internal/numpy/_core/_multiarray_umath.cp312-win_amd64.pyd",
    "_internal/soxr/soxr_ext.pyd",
    "_internal/python312.dll",
])
def test_the_audit_keeps_what_the_core_loads_at_run_time(build, bundle, name):
    path = bundle / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")

    assert any(item["path"] == name for item in build.audit_bundle(bundle)["files"])


class FakeDistribution:
    def __init__(self, requires):
        self.requires = requires


def fake_distributions(notices, monkeypatch, requires):
    monkeypatch.setattr(notices, "distribution", lambda name: FakeDistribution(requires[name]))


def test_an_extra_that_a_requirement_asks_for_brings_in_what_it_needs(notices, monkeypatch):
    # mcp asks for "pyjwt[crypto]": pyjwt then needs cryptography, which it does not alone.
    fake_distributions(
        notices,
        monkeypatch,
        {
            "raphael-core": ["mcp", "alone"],
            "mcp": ["pyjwt[crypto]>=2.10", "elsewhere; sys_platform == 'no-such-platform'"],
            "pyjwt": ['cryptography>=3.4; extra == "crypto"', "typing-extensions"],
            "cryptography": ["cffi"],
            "cffi": [],
            "typing-extensions": [],
            "alone": ["pyjwt"],
        },
    )
    assert notices.runtime_distributions() == [
        "alone",
        "cffi",
        "cryptography",
        "mcp",
        "pyjwt",
        "raphael-core",
        "typing-extensions",
    ]


def test_a_distribution_asked_for_without_the_extra_does_not_bring_it_in(notices, monkeypatch):
    fake_distributions(
        notices,
        monkeypatch,
        {
            "raphael-core": ["pyjwt"],
            "pyjwt": ['cryptography>=3.4; extra == "crypto"'],
            "cryptography": [],
        },
    )
    assert notices.runtime_distributions() == ["pyjwt", "raphael-core"]


def test_a_cycle_of_requirements_ends(notices, monkeypatch):
    fake_distributions(
        notices,
        monkeypatch,
        {"raphael-core": ["a"], "a": ["b[x]"], "b": ['a; extra == "x"', "b"]},
    )
    assert notices.runtime_distributions() == ["a", "b", "raphael-core"]


def test_the_notices_cover_cryptography_which_the_plugin_sdk_pulls_in(notices):
    names = notices.runtime_distributions()
    for name in ("mcp", "mcp-types", "pydantic", "pydantic-core", "pyjwt", "cryptography"):
        assert name in names
