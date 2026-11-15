"""SpellDirector's director: library functions and the MCP server."""

from pathlib import Path

# The repo-root VERSION file is the single source of truth for the app version.
__version__ = (Path(__file__).resolve().parent.parent / "VERSION").read_text(encoding="utf-8").strip()
