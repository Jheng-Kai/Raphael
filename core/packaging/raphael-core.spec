# -*- mode: python ; coding: utf-8 -*-
"""Windows x64 or macOS onedir bundle. All additional inputs come from locked distributions."""

import sys
from importlib.metadata import distribution
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
    copy_metadata,
    get_package_paths,
)

packaging_dir = Path(SPECPATH)
core_dir = packaging_dir.parent
sys.path.insert(0, str(packaging_dir))
from notices import runtime_distributions

binaries = []
datas = []
WINDOWS = sys.platform == "win32"
# The native libraries of the platform: DLLs on Windows, dylibs on macOS.
LIBRARY_SUFFIX = ".dll" if WINDOWS else ".dylib"

hiddenimports = [
    # The background worker is this executable started with --worker; __main__ imports its module
    # inside a function, which the build would find too, but a worker left out is not found by a test
    # until the smoke test, so it is named.
    "raphael_core.worker.runner",
    # The credential store: Windows Credential Manager, or the macOS Keychain.
    "keyring.backends.Windows" if WINDOWS else "keyring.backends.macOS",
    "keyring.backends.fail", "keyring.backends.null",
    "opencc.clib.opencc_clib", "sherpa_onnx.lib._sherpa_onnx",
    # soundfile (the audio decoder of voice messages) loads libsndfile from _soundfile_data.
    "_soundfile",
]
for package in ("sherpa_onnx", "numpy", "soxr", "opencc", "_soundfile_data"):
    binaries += collect_dynamic_libs(package)
for package in ("soxr", "win32ctypes") if WINDOWS else ("soxr",):
    hiddenimports += collect_submodules(package, filter=lambda name: "tests" not in name.split("."))

# sherpa-onnx-core is a distribution, not an importable package. Keep its libraries beside the binding.
sherpa_core = distribution("sherpa-onnx-core")
for item in sherpa_core.files or []:
    relative = Path(str(item))
    if relative.parts[:2] == ("sherpa_onnx", "lib") and relative.suffix.lower() == LIBRARY_SUFFIX:
        binaries.append((str(sherpa_core.locate_file(item)), "sherpa_onnx/lib"))

# Delvewheel places OpenCC and NumPy runtime DLLs next to, rather than in, their packages (Windows);
# delocate puts NumPy's in `numpy/.dylibs`, which collect_dynamic_libs already found (macOS).
for package in ("opencc", "numpy") if WINDOWS else ():
    parent, _ = get_package_paths(package)
    library_dir = Path(parent) / f"{package}.libs"
    binaries += [(str(path), library_dir.name) for path in library_dir.glob("*.dll")]

datas += collect_data_files("opencc", includes=["clib/share/opencc/*.json", "clib/share/opencc/*.ocd2"])
datas += collect_data_files("raphael_core.brain.prompts", includes=["*.md"])
datas += collect_data_files("raphael_core.connectors", includes=["finder-data.json"])
datas += collect_data_files("raphael_core.computer", include_py_files=True, includes=["image/**/*", "wallpaper/**/*", "driver_schemas.json"])
for name in runtime_distributions():
    datas += copy_metadata(name)
datas.append((str(core_dir / "build" / "notices"), "licenses"))

analysis = Analysis(
    [str(packaging_dir / "entrypoint.py")],
    pathex=[str(core_dir / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[str(packaging_dir / "hooks")],
    runtime_hooks=[],
    excludes=[
        "pytest", "_pytest", "setuptools", "pkg_resources", "pygments",
        "raphael_core.evaluate", "tkinter", "unittest", "win32ctypes.tests", "numpy.testing",
        # The Windows-only binaries of PortAudio's wheel are never loaded on macOS.
        *([] if WINDOWS else ["win32ctypes"]),
        # NumPy's own PyInstaller hook adds this C test helper; only NumPy's tests import it.
        "numpy._core._multiarray_tests",
    ],
    noarchive=False,
)


def unneeded(item):
    """Files that are collected as a side effect but that the core never loads at run time.

    The pyinstaller-hooks-contrib OpenCC hook copies the whole wheel, including its command-line
    tools, C++ headers and the static libraries opencc.lib and marisa.lib (about 8 MB); the
    conversion itself needs only opencc_clib.pyd and the dictionaries under clib/share/opencc.
    NumPy's C test helpers (_multiarray_tests, _umath_tests, ...) are imported only by its tests.
    """
    destination = item[0].replace("\\", "/")
    stem = destination.rsplit("/", 1)[-1].split(".")[0]
    return (
        destination.endswith("direct_url.json")  # local editable-install provenance
        or destination.startswith(("opencc/clib/bin/", "opencc/clib/include/", "opencc/clib/lib/"))
        or (destination.endswith((".pyd", ".dll", ".so", ".dylib")) and stem.endswith(("_test", "_tests")))
    )


analysis.datas = [item for item in analysis.datas if not unneeded(item)]
analysis.binaries = [item for item in analysis.binaries if not unneeded(item)]
for name, _, _ in analysis.pure:
    if name.split(".")[0] in {"pytest", "_pytest", "setuptools", "pygments"}:
        raise RuntimeError(f"Unexpected development module in bundle: {name}")
pyz = PYZ(analysis.pure)
# On macOS a release signs every collected binary and the executable with the hardened runtime, so
# that the app that carries the core can be notarized (RAPHAEL_CODESIGN_IDENTITY, set by the release
# workflow; an unsigned development bundle is signed ad hoc by PyInstaller).
import os

macos_signing = {} if WINDOWS else {
    "codesign_identity": os.environ.get("RAPHAEL_CODESIGN_IDENTITY") or None,
    "entitlements_file": str(core_dir.parent / "app" / "src-tauri" / "Entitlements.plist"),
}
exe = EXE(
    pyz, analysis.scripts, [], exclude_binaries=True, name="raphael-core",
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True, disable_windowed_traceback=False, contents_directory="_internal",
    **macos_signing,
)
collect = COLLECT(exe, analysis.binaries, analysis.datas, strip=False, upx=False, name="raphael-core")
