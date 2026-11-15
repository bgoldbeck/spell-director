"""Entry point of the packaged SpellDirector.exe: serve the viewer and open it."""

from __future__ import annotations

import sys

import serve


def main() -> int:
    print(f"SpellDirector {serve.VERSION}", flush=True)
    print("Close this window to stop the viewer.\n", flush=True)
    return serve.main(["--open", *sys.argv[1:]])


if __name__ == "__main__":
    sys.exit(main())
