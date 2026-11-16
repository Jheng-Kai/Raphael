"""Ship the PortAudio library Raphael uses: the Windows x64 non-ASIO DLL, or the macOS dylib."""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import get_module_file_attribute


package = Path(get_module_file_attribute("_sounddevice_data")).parent
name = "libportaudio64bit.dll" if sys.platform == "win32" else "libportaudio.dylib"
library = package / "portaudio-binaries" / name
if not library.is_file():
    raise RuntimeError(f"The PortAudio library is missing: {library}")
binaries = [(str(library), "_sounddevice_data/portaudio-binaries")]
datas = [(str(package / "portaudio-binaries" / "README.md"),
          "_sounddevice_data/portaudio-binaries")]
