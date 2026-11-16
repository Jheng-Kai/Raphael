"""Collect installed runtime distribution metadata and license files without repository data."""

from __future__ import annotations

import decimal
import hashlib
import json
import platform
import pyexpat
import shutil
import ssl
import sys
from importlib.metadata import distribution
from pathlib import Path

import soundfile
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

LICENSES = Path(__file__).resolve().parent / "licenses"
ADAPTED_LICENSE_FILES = ("NOTICES.md", "Apache-2.0.txt", "hermes-agent-MIT.txt", "OpenBot-MIT.txt")
# The source manifest of each platform the core is built on. The Windows x64 runtime builds Expat and
# libmpdec from the copies in CPython and loads OpenSSL and libffi as DLLs; the macOS (Apple silicon)
# runtime, python-build-standalone, links its own Expat, libmpdec, libffi, OpenSSL, bzip2, liblzma and
# SQLite into libpython3.12.dylib, and the wheels ship other builds of their libraries.
SOURCE_MANIFESTS = {"win32": "sources.json", "darwin": "sources-macos.json"}


def macos(system: str | None = None) -> bool:
    """Whether the notices describe the macOS build: `system` is a sys.platform value, this one by default."""
    return (system or sys.platform) == "darwin"


def manifest_name(system: str | None = None) -> str:
    """The file name of the source manifest of the build; any platform but macOS keeps the Windows one."""
    return SOURCE_MANIFESTS["darwin" if macos(system) else "win32"]


def load_source_manifest(system: str | None = None) -> dict:
    """licenses/sources.json (Windows) or licenses/sources-macos.json (macOS), with every pinned license
    text checked against its SHA-256."""
    name = manifest_name(system)
    manifest = json.loads((LICENSES / name).read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise RuntimeError(f"Unsupported licenses/{name} schema")
    for item in manifest["licenses"]:
        if hashlib.sha256((LICENSES / item["file"]).read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError(f"Upstream license checksum mismatch: {item['file']}")
    return manifest


def other_platform_files(system: str | None = None) -> set[str]:
    """The other platforms' manifests and the license texts that only they list: not shipped in this build."""
    def listed(name: str) -> set[str]:
        return {item["file"] for item in json.loads((LICENSES / name).read_text(encoding="utf-8"))["licenses"]}

    own = manifest_name(system)
    others = set(SOURCE_MANIFESTS.values()) - {own}
    return others.union(*(listed(name) for name in others)) - listed(own)


def standalone_release() -> str | None:
    """The python-build-standalone release of this interpreter, which uv records in BUILD beside it."""
    path = Path(sys.base_prefix) / "BUILD"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else None


def installed_versions() -> dict[str, str]:
    """The versions that this platform's source manifest pins, as this interpreter and environment have them."""
    versions = {
        "python": platform.python_version(),
        "openssl": ssl.OPENSSL_VERSION.split()[1],
        "expat": pyexpat.EXPAT_VERSION.removeprefix("expat_"),
        "libmpdec": decimal.__libmpdec_version__,
        "opencc": distribution("opencc").version,
        "soxr": distribution("soxr").version,
        "soundfile": distribution("soundfile").version,
        "libsndfile": soundfile.__libsndfile_version__,
    }
    if macos():
        # libpython3.12.dylib also contains libffi, bzip2, liblzma and SQLite, whose versions Python
        # does not all report; the python-build-standalone release fixes every one of them.
        versions["python-build-standalone"] = standalone_release()
    return versions


def check_pinned_versions(pinned: dict[str, str], installed: dict[str, str], name: str | None = None) -> None:
    """Refuse to write notices whose pinned texts and source links describe other versions."""
    stale = [f"{key}: pinned {version}, installed {installed.get(key)}"
             for key, version in pinned.items() if installed.get(key) != version]
    if stale:
        raise RuntimeError(f"licenses/{name or manifest_name()} describes other versions than this build; re-verify "
                           "its texts and source links, then update pinned_versions: " + "; ".join(stale))


def component_sections(manifest: dict, name: str | None = None) -> list[str]:
    """Notice text for the libraries compiled into the runtime and wheels, and for LGPL source code."""
    lines = [
        "", "## Libraries compiled into the Python runtime and wheels", "",
        f"Each license text is copied verbatim from the exact upstream version; licenses/{name or manifest_name()}",
        "records its source URL and SHA-256. File paths are relative to the core's _internal folder.", "",
    ]
    lines += [f"- {item['component']} ({item['license']}): {item['shipped_in']}. Text: upstream/{item['file']}"
              for item in manifest["licenses"] if "component" in item]
    lines += [
        "", "## Source code of LGPL components", "",
        "Raphael uses these libraries unmodified. libsoxr is LGPL-2.1-or-later. marisa-trie is dual-licensed:",
        "Raphael uses it under the BSD-2-Clause terms, and its source is listed here as well. The source",
        "that corresponds to the binaries in this release is at:", "",
    ]
    for item in manifest["source_code"]:
        lines.append(f"- {item['component']} ({item['license']}): {item['shipped_in']}")
        lines += [f"    {source['label']}: {source['url']}"
                  + (f" (SHA-256 {source['sha256']})" if "sha256" in source else "") for source in item["sources"]]
    lines.append("")
    return lines


def needed_requirements(requires: list[str], extras: set[str]) -> list[Requirement]:
    """The requirements of a distribution that apply on this machine, for the extras that were asked
    for: `pyjwt[crypto]` asks for pyjwt's `cryptography`, which `pyjwt` alone does not need."""
    needed = []
    for raw in requires:
        requirement = Requirement(raw)
        if requirement.marker is None or any(
            requirement.marker.evaluate({"extra": extra}) for extra in ("", *extras)
        ):
            needed.append(requirement)
    return needed


def runtime_distributions() -> list[str]:
    pending: list[tuple[str, frozenset[str]]] = [("raphael-core", frozenset())]
    seen: set[str] = set()
    expanded: set[tuple[str, frozenset[str]]] = set()
    while pending:
        raw_name, extras = pending.pop()
        name = canonicalize_name(raw_name)
        seen.add(name)
        if (name, extras) in expanded:
            continue
        expanded.add((name, extras))
        wanted = {canonicalize_name(extra) for extra in extras}
        for requirement in needed_requirements(distribution(name).requires or [], wanted):
            pending.append((requirement.name, frozenset(requirement.extras)))
    return sorted(seen)


def python_license(system: str | None = None) -> Path:
    """The Python runtime's license: beside python.exe on Windows, in the standard library on macOS."""
    if macos(system):
        return Path(sys.base_prefix) / "lib" / f"python{sys.version_info[0]}.{sys.version_info[1]}" / "LICENSE.txt"
    return Path(sys.base_prefix) / "LICENSE.txt"


def native_dependency_lines(manifest: dict, system: str | None = None) -> list[str]:
    """Where the native libraries of the wheels come from, and which notices cover them."""
    if not macos(system):
        return [
            "", "## Native dependencies", "",
            "sherpa-onnx-core installs its DLLs into sherpa_onnx/lib; it has no separate license file in its wheel.",
            "Its Apache-2.0 declaration is preserved in METADATA; sherpa-onnx's Apache license is included.",
            "The release notice includes the upstream ONNX Runtime 1.28.2 third-party notices.",
            "PortAudio's upstream license is included; the wheel's PortAudio README is preserved in _internal.",
            "NumPy and python-soxr wheel licenses include their bundled native dependency notices.",
            "soundfile's libsndfile_x64.dll links libsndfile, libopus, libvorbis, libogg, libFLAC, LAME and mpg123",
            "statically; the wheel's licensing/license_notes.md lists their copyrights and sources.",
            "", "Upstream sources:",
            "- https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE",
            "- https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/cmake/onnxruntime-win-x64.cmake",
            "- https://github.com/microsoft/onnxruntime/blob/v1.28.2/LICENSE",
            "- https://github.com/microsoft/onnxruntime/blob/v1.28.2/ThirdPartyNotices.txt",
            "- https://github.com/PortAudio/portaudio/blob/v19.7.0/LICENSE.txt",
        ]
    release = manifest["pinned_versions"]["python-build-standalone"]
    return [
        "", "## Native dependencies", "",
        f"The Python runtime is python-build-standalone {release}; the libraries it links into libpython3.12.dylib",
        "are listed below. zlib, libedit and ncurses are loaded from macOS and are not bundled.",
        "sherpa-onnx-core installs its dylibs into sherpa_onnx/lib; it has no separate license file in its wheel.",
        "Its Apache-2.0 declaration is preserved in METADATA; sherpa-onnx's Apache license is included.",
        "The release notice includes the upstream ONNX Runtime 1.28.2 third-party notices.",
        "PortAudio's upstream license is included; the wheel's PortAudio README is preserved in _internal.",
        "python-soxr's wheel license includes its bundled native dependency notices. NumPy's macOS wheel uses",
        "Apple's Accelerate framework and bundles no native library; its license also covers other platforms' wheels.",
        "soundfile's libsndfile_arm64.dylib links libsndfile, libopus, libvorbis, libogg, libFLAC, LAME and",
        "mpg123 statically; the wheel's licensing/license_notes.md lists their copyrights and sources.",
        "", "Upstream sources:",
        "- https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE",
        "- https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/cmake/onnxruntime-osx-arm64.cmake",
        "- https://github.com/microsoft/onnxruntime/blob/v1.28.2/LICENSE",
        "- https://github.com/microsoft/onnxruntime/blob/v1.28.2/ThirdPartyNotices.txt",
        "- https://github.com/PortAudio/portaudio/blob/v19.7.0/LICENSE.txt",
        f"- https://github.com/astral-sh/python-build-standalone/releases/tag/{release}",
    ]


def write_notices(target: Path, system: str | None = None) -> None:
    """The notices of the core built on this platform (`system`, a sys.platform value, is for tests)."""
    expected = Path(__file__).resolve().parent.parent / "build" / "notices"
    if target.resolve() != expected.resolve():
        raise RuntimeError("Notices must be generated inside this core's build directory")
    manifest_file = manifest_name(system)
    source_manifest = load_source_manifest(system)
    check_pinned_versions(source_manifest["pinned_versions"], installed_versions(), manifest_file)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    inventory = []
    lines = [
        "Third-party components in the frozen Raphael core", "",
        "License files below are copied verbatim from the locked installed distributions.",
        "The Python runtime and PyInstaller bootloader license are included separately.",
        "Speech models, ASIO binaries, recordings, credentials and private assets are not bundled.",
        "This inventory covers the Python core; the desktop installer has additional components.", "",
    ]
    for name in [*runtime_distributions(), "pyinstaller"]:
        dist = distribution(name)
        if name == "raphael-core":
            continue
        folder = target / name
        folder.mkdir(exist_ok=True)
        (folder / "METADATA").write_text(dist.read_text("METADATA") or "", encoding="utf-8")
        licenses = []
        for item in dist.files or []:
            relative = Path(str(item))
            if ".." in relative.parts or not any(
                word in relative.name.lower() for word in ("license", "copying", "notice", "authors")
            ):
                continue
            source = Path(dist.locate_file(item))
            if not source.is_file():
                continue
            destination = folder / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            licenses.append(destination.relative_to(target).as_posix())
        inventory.append({"name": name, "version": dist.version, "license_files": licenses})
        lines.append(f"- {name} {dist.version}: {', '.join(licenses) or 'see METADATA and upstream sources below'}")
    python_folder = target / "python"
    python_folder.mkdir(exist_ok=True)
    shutil.copyfile(python_license(system), python_folder / "LICENSE.txt")
    lines.extend(native_dependency_lines(source_manifest, system))
    lines.extend(component_sections(source_manifest, manifest_file))
    # Only this platform's texts: the other platform's manifest and its own versions are not shipped.
    excluded = other_platform_files(system)
    shutil.copytree(LICENSES, target / "upstream", dirs_exist_ok=True,
                    ignore=lambda folder, names: [name for name in names if name in excluded])
    for name in ADAPTED_LICENSE_FILES:
        shutil.copyfile(LICENSES / name, target / name)
    # Provide one self-contained text file for release assets and the installer notice.
    license_paths = [target / item for dist in inventory for item in dist["license_files"]]
    license_paths += [python_folder / "LICENSE.txt"]
    license_paths += [target / "upstream" / item["file"] for item in source_manifest["licenses"]]
    license_paths += [target / name for name in ADAPTED_LICENSE_FILES]
    for path in license_paths:
        lines.extend(["", "=" * 72, path.relative_to(target).as_posix(), "=" * 72,
                      path.read_text(encoding="utf-8", errors="replace")])
    (target / "THIRD_PARTY_NOTICES.txt").write_text("\n".join(lines), encoding="utf-8")
    (target / "distributions.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
