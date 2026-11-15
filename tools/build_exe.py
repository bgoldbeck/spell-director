"""Build the SpellDirector viewer as one double-click executable with PyInstaller.

    python -m pip install -r requirements-build.txt
    python tools/build_exe.py            # -> dist/SpellDirector-v<version>-<os>.exe

The exe serves the bundled viewer, templates and schemas on localhost and
opens the browser, like run.bat, with no Python install needed. PyInstaller
builds for the OS it runs on, so build the Windows exe on Windows.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLED = ["web", "templates", "schemas", "VERSION"]


def platform_tag() -> str:
    return {"win32": "windows", "darwin": "macos"}.get(sys.platform, sys.platform)


def exe_name(version: str) -> str:
    return f"SpellDirector-v{version}-{platform_tag()}"


def exe_path(version: str) -> Path:
    suffix = ".exe" if sys.platform == "win32" else ""
    return ROOT / "dist" / (exe_name(version) + suffix)


def pyinstaller_args(version: str) -> list[str]:
    args = [sys.executable, "-m", "PyInstaller", "--onefile", "--console", "--noconfirm", "--clean",
            "--name", exe_name(version),
            "--paths", str(ROOT / "tools"),
            "--distpath", str(ROOT / "dist"),
            "--workpath", str(ROOT / "build" / "pyinstaller"),
            "--specpath", str(ROOT / "build" / "pyinstaller")]
    for item in BUNDLED:
        src = ROOT / item
        dest = "." if src.is_file() else item
        args += ["--add-data", f"{src}{os.pathsep}{dest}"]
    args.append(str(ROOT / "tools" / "exe_main.py"))
    return args


def build(version: str | None = None) -> Path:
    version = version or (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    subprocess.run(pyinstaller_args(version), check=True, cwd=ROOT)
    out = exe_path(version)
    if not out.exists():
        raise SystemExit(f"PyInstaller finished but {out} is missing")
    print(f"built {out}")
    return out


if __name__ == "__main__":
    build()
