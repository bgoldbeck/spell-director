"""Connect SpellDirector's director to AI apps on this computer, in one step.

    SpellDirector.exe --setup          from the Windows app
    python tools/client_setup.py       from the source folder

Writes a "spelldirector" MCP server entry into each AI app it finds:

- Claude Desktop: claude_desktop_config.json (merged; other servers are kept,
  and the old file is saved next to it as .bak first).
- Claude Code: through its own `claude mcp add --scope user` command.
- Codex (the ChatGPT desktop app's Codex, the Codex CLI and IDE extension share
  one file): a [mcp_servers.spelldirector] table in ~/.codex/config.toml, with a
  longer startup timeout because the app takes a while to unpack.

The ChatGPT website can't start programs on your computer, so it isn't set up
here (see docs/setup.md for what works there).

The entry points at the running exe, or at this Python and source folder, so
it is always the copy you ran. When a new version of the exe starts, it calls
refresh() so apps already set up follow it to the new file without asking.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import app_paths

NAME = "spelldirector"
CLIENTS = ("claude-desktop", "claude-code", "codex")
LABELS = {"claude-desktop": "Claude Desktop", "claude-code": "Claude Code",
          "codex": "Codex / ChatGPT desktop app"}
CODEX_STARTUP_TIMEOUT = 120  # seconds; Codex's default (10) is shorter than the exe's first start


# ---------------------------------------------------------------- the server entry


def server_entry(library: str | None = None) -> dict:
    """The MCP server entry for this copy: the exe with --mcp, or Python on the source folder."""
    if app_paths.FROZEN:
        entry = {"command": str(Path(sys.executable).resolve()), "args": ["--mcp"]}
    else:
        entry = {"command": str(Path(sys.executable).resolve()), "args": ["-m", "director.mcp_server"],
                 "env": {"PYTHONPATH": str(app_paths.BUNDLE)}}
    if library and app_paths.FROZEN:
        entry["args"] += ["--library", library]
    elif library:
        entry["env"][app_paths.LIBRARY_ENV] = library
    return entry


def _is_spelldirector_exe(command: str) -> bool:
    return Path(str(command)).name.lower().startswith("spelldirector")


# ---------------------------------------------------------------- where each app keeps its settings


def claude_desktop_files() -> list[Path]:
    """Claude Desktop's config file(s). On Windows the Microsoft Store build keeps
    its own copy under LocalAppData\\Packages; both are returned when present.
    The first one is the place to create when Claude Desktop isn't installed yet."""
    home = Path.home()
    if sys.platform == "win32":
        appdata = Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming")
        local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
        files = [appdata / "Claude" / "claude_desktop_config.json"]
        packages = local / "Packages"
        if packages.is_dir():
            for pkg in sorted(packages.glob("Claude_*")):
                files.append(pkg / "LocalCache" / "Roaming" / "Claude" / "claude_desktop_config.json")
        return files
    if sys.platform == "darwin":
        return [home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"]
    return [Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config") / "Claude" / "claude_desktop_config.json"]


def codex_file() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "config.toml"


def claude_code_file() -> Path:
    return Path.home() / ".claude.json"


def claude_cli() -> str | None:
    return shutil.which("claude")


# ---------------------------------------------------------------- reading what is there


def _read_json(path: Path) -> dict | None:
    """The file's JSON object; {} when the file is missing or empty; None when it can't be read safely."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except OSError:
        return None
    if not text.strip():
        return {}
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


_TABLE = re.compile(r"^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$")


def _codex_table_span(text: str) -> tuple[int, int] | None:
    """Line span [start, end) of [mcp_servers.spelldirector] and its sub-tables."""
    lines = text.splitlines(keepends=True)
    start = None
    for i, line in enumerate(lines):
        m = _TABLE.match(line)
        if not m:
            continue
        key = m.group(1).replace('"', "").replace("'", "").replace(" ", "")
        mine = key == f"mcp_servers.{NAME}" or key.startswith(f"mcp_servers.{NAME}.")
        if start is None and mine:
            start = i
        elif start is not None and not mine:
            return start, i
    return (start, len(lines)) if start is not None else None


def _codex_entry(text: str) -> dict | None:
    span = _codex_table_span(text)
    if span is None:
        return None
    block = "".join(text.splitlines(keepends=True)[span[0]:span[1]])
    try:
        import tomllib
        data = tomllib.loads(block)
        return data.get("mcp_servers", {}).get(NAME) or {}
    except Exception:  # noqa: BLE001  (tomllib is 3.11+, and the block may be odd)
        m = re.search(r'^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"', block, re.M)
        return {"command": json.loads(f'"{m.group(1)}"')} if m else {}


def _toml_str(value: str) -> str:
    # JSON string escapes are valid TOML basic-string escapes.
    return json.dumps(value, ensure_ascii=False)


def _codex_block(entry: dict) -> str:
    lines = [f"[mcp_servers.{NAME}]",
             f"command = {_toml_str(entry['command'])}",
             "args = [" + ", ".join(_toml_str(a) for a in entry.get("args", [])) + "]",
             f"startup_timeout_sec = {CODEX_STARTUP_TIMEOUT}"]
    if entry.get("env"):
        lines.append("env = { " + ", ".join(f"{k} = {_toml_str(v)}" for k, v in entry["env"].items()) + " }")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- status


def _same(a: dict | None, b: dict) -> bool:
    if not isinstance(a, dict):
        return False
    norm = lambda p: os.path.normcase(os.path.normpath(str(p)))  # noqa: E731
    return (norm(a.get("command", "")) == norm(b["command"]) and list(a.get("args") or []) == b.get("args", [])
            and (a.get("env") or {}) == (b.get("env") or {}))


def status(entry: dict | None = None) -> dict:
    """For each app: is it on this computer, is SpellDirector set up in it, and does it point at this copy."""
    entry = entry or server_entry()
    out = {}

    files = claude_desktop_files()
    found = [f for f in files if f.parent.is_dir()]
    current = [(_read_json(f) or {}).get("mcpServers", {}).get(NAME) for f in found]
    out["claude-desktop"] = {"found": bool(found), "configured": any(current),
                             "current": bool(current) and all(_same(c, entry) for c in current),
                             "where": str((found or files)[0])}

    cc = (_read_json(claude_code_file()) or {}).get("mcpServers", {}).get(NAME)
    out["claude-code"] = {"found": bool(claude_cli()), "configured": bool(cc),
                          "current": _same(cc, entry), "where": "claude mcp (user scope)"}

    cfile = codex_file()
    try:
        cx = _codex_entry(cfile.read_text(encoding="utf-8"))
    except OSError:
        cx = None
    out["codex"] = {"found": cfile.parent.is_dir() or bool(shutil.which("codex")), "configured": cx is not None,
                    "current": cx is not None and _same(cx, entry), "where": str(cfile)}
    for key, value in out.items():
        value["label"] = LABELS[key]
    return out


# ---------------------------------------------------------------- writing


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".bak"))
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def setup_claude_desktop(entry: dict) -> dict:
    files = claude_desktop_files()
    targets = [f for f in files if f.parent.is_dir()] or files[:1]
    results = []
    for path in targets:
        data = _read_json(path)
        if data is None:
            results.append({"ok": False, "where": str(path),
                            "message": "Its settings file isn't valid JSON, so it was left alone. Fix or delete it, then try again."})
            continue
        servers = data.get("mcpServers")
        if not isinstance(servers, dict):
            servers = data["mcpServers"] = {}
        if _same(servers.get(NAME), entry):
            results.append({"ok": True, "changed": False, "where": str(path)})
            continue
        servers[NAME] = entry
        try:
            _write_json(path, data)
        except OSError as exc:
            results.append({"ok": False, "where": str(path), "message": f"Couldn't write it: {exc}"})
            continue
        results.append({"ok": True, "changed": True, "where": str(path)})
    ok = all(r["ok"] for r in results)
    changed = any(r.get("changed") for r in results)
    return {"client": "claude-desktop", "ok": ok, "changed": changed, "where": results[0]["where"],
            "message": (results[0].get("message") if not ok else
                        "Done. Quit Claude Desktop completely (right-click its tray icon, Quit) and open it again."
                        if changed else "Already set up for this copy.")}


def setup_claude_code(entry: dict) -> dict:
    cli = claude_cli()
    if not cli:
        return {"client": "claude-code", "ok": False, "changed": False,
                "message": "Claude Code isn't installed (no `claude` command found)."}
    if _same((_read_json(claude_code_file()) or {}).get("mcpServers", {}).get(NAME), entry):
        return {"client": "claude-code", "ok": True, "changed": False, "message": "Already set up for this copy."}
    run = lambda args: subprocess.run([cli, *args], capture_output=True, text=True, timeout=60,  # noqa: E731
                                      stdin=subprocess.DEVNULL)
    try:
        run(["mcp", "remove", "--scope", "user", NAME])
        env = [x for k, v in (entry.get("env") or {}).items() for x in ("-e", f"{k}={v}")]
        done = run(["mcp", "add", "--scope", "user", *env, NAME, "--", entry["command"], *entry["args"]])
    except (OSError, subprocess.SubprocessError) as exc:
        return {"client": "claude-code", "ok": False, "changed": False, "message": f"`claude mcp add` failed: {exc}"}
    if done.returncode != 0:
        return {"client": "claude-code", "ok": False, "changed": False,
                "message": "`claude mcp add` failed: " + (done.stderr or done.stdout).strip()[:300]}
    return {"client": "claude-code", "ok": True, "changed": True,
            "message": "Done. Start a new Claude Code session; /mcp should list spelldirector."}


def setup_codex(entry: dict) -> dict:
    path = codex_file()
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    except OSError as exc:
        return {"client": "codex", "ok": False, "changed": False, "where": str(path), "message": f"Couldn't read it: {exc}"}
    current = _codex_entry(text)
    block = _codex_block(entry)
    if current is not None and _same(current, entry) and f"startup_timeout_sec = {CODEX_STARTUP_TIMEOUT}" in text:
        return {"client": "codex", "ok": True, "changed": False, "where": str(path), "message": "Already set up for this copy."}
    span = _codex_table_span(text)
    if span is not None:
        lines = text.splitlines(keepends=True)
        new = "".join(lines[:span[0]]) + block + ("\n" if span[1] < len(lines) else "") + "".join(lines[span[1]:])
    else:
        new = text + ("\n" if text and not text.endswith("\n") else "") + ("\n" if text.strip() else "") + block
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            shutil.copy2(path, path.with_name(path.name + ".bak"))
        path.write_text(new, encoding="utf-8")
    except OSError as exc:
        return {"client": "codex", "ok": False, "changed": False, "where": str(path), "message": f"Couldn't write it: {exc}"}
    return {"client": "codex", "ok": True, "changed": True, "where": str(path),
            "message": "Done. Restart the ChatGPT desktop app or Codex."}


SETUP = {"claude-desktop": setup_claude_desktop, "claude-code": setup_claude_code, "codex": setup_codex}


def setup(clients: list[str] | None = None, entry: dict | None = None) -> list[dict]:
    """Set up the named apps, or every app found on this computer (Claude Desktop always:
    it is the one most people use, and its file is ready when they install it)."""
    entry = entry or server_entry()
    if clients is None:
        found = status(entry)
        clients = [c for c in CLIENTS if c == "claude-desktop" or found[c]["found"]]
    return [SETUP[c](entry) for c in clients if c in SETUP]


def refresh(entry: dict | None = None) -> list[str]:
    """When a new copy of the exe starts: apps already set up for another SpellDirector
    exe follow this one, keeping their other arguments (such as --library). If the old
    copy was in another folder and had spells there, --library keeps using them.
    Returns the names of the apps that changed. Never raises."""
    if not app_paths.FROZEN and entry is None:
        return []
    entry = entry or server_entry()
    changed = []
    try:
        st = status(entry)
        for client in CLIENTS:
            if not st[client]["configured"] or st[client]["current"]:
                continue
            old = _old_entry(client)
            if not old or not _is_spelldirector_exe(old.get("command", "")):
                continue  # set up by hand for something else (e.g. the source folder): leave it
            new = dict(entry)
            args = list(old.get("args") or ["--mcp"])
            old_lib = Path(old["command"]).parent / app_paths.LIBRARY_FOLDER_NAME
            if ("--library" not in args and Path(old["command"]).parent != Path(entry["command"]).parent
                    and old_lib.is_dir()):
                args += ["--library", str(old_lib)]
            new["args"] = args
            if SETUP[client](new).get("changed"):
                changed.append(LABELS[client])
    except Exception:  # noqa: BLE001  never stop the app over this
        return changed
    return changed


def _old_entry(client: str) -> dict | None:
    if client == "claude-desktop":
        for f in claude_desktop_files():
            e = (_read_json(f) or {}).get("mcpServers", {}).get(NAME)
            if e:
                return e
        return None
    if client == "claude-code":
        return (_read_json(claude_code_file()) or {}).get("mcpServers", {}).get(NAME)
    try:
        return _codex_entry(codex_file().read_text(encoding="utf-8"))
    except OSError:
        return None


# ---------------------------------------------------------------- command line


def report(results: list[dict]) -> str:
    lines = []
    for r in results:
        mark = "OK " if r["ok"] else "!! "
        lines.append(f"{mark}{LABELS[r['client']]}: {r['message']}")
        if r.get("where") and r["ok"] and r.get("changed"):
            lines.append(f"    ({r['where']})")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Connect SpellDirector's director to the AI apps on this computer.")
    ap.add_argument("--client", action="append", choices=CLIENTS,
                    help="only this app (repeatable); default: every app found")
    ap.add_argument("--library", help="folder for saved spells, exports and breakdowns")
    ap.add_argument("--status", action="store_true", help="only show what is set up")
    args = ap.parse_args(argv)
    entry = server_entry(args.library)
    if args.status:
        for key, s in status(entry).items():
            state = "set up for this copy" if s["current"] else "set up for another copy" if s["configured"] \
                else "not set up" if s["found"] else "not found"
            print(f"{s['label']}: {state}")
        return 0
    results = setup(args.client, entry)
    print(report(results))
    print("\nThen ask the AI: \"List the SpellDirector spells.\" If it shows a list, you're connected.")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
