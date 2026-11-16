"""Entry point of the packaged SpellDirector.exe.

    SpellDirector.exe                  serve the viewer and open it in the browser
    SpellDirector.exe --mcp            run the director's MCP server on stdio, for
                                       Claude Desktop, Claude Code or any MCP client
    SpellDirector.exe --mcp --library "D:\\Spells"
                                       keep saved templates, exports and breakdowns there

Without --library, the user's files go to a "SpellDirector Library" folder next
to the exe (tools/app_paths.py). The viewer, started either way, shows those
templates next to the built-in ones.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import sys
import threading

import app_paths
import serve


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--mcp" in argv:
        return run_mcp(argv)
    library, argv = _pop_library(argv)
    if library:
        os.environ[app_paths.LIBRARY_ENV] = library
    print(f"SpellDirector {serve.VERSION}", flush=True)
    print(f"Your library: {app_paths.library_root()}", flush=True)
    print("Close this window to stop the viewer.\n", flush=True)
    return serve.main(["--open", *argv])


def _pop_library(argv: list[str]) -> tuple[str | None, list[str]]:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--library")
    args, rest = ap.parse_known_args(argv)
    return args.library, rest


def run_mcp(argv: list[str]) -> int:
    """The director's MCP server. stdout is the MCP channel: nothing else may go there."""
    ap = argparse.ArgumentParser(prog="SpellDirector", description="Run the SpellDirector MCP server on stdio.")
    ap.add_argument("--mcp", action="store_true", required=True, help="run the MCP server (this mode)")
    ap.add_argument("--library", help='folder for saved templates, exports and breakdowns '
                                      '(default: "SpellDirector Library" next to the exe)')
    ap.add_argument("--no-viewer", action="store_true",
                    help="don't start the viewer in the background for the preview links")
    with contextlib.redirect_stdout(sys.stderr):  # --help and errors must not hit the MCP channel
        args = ap.parse_args(argv)
    if args.library:
        os.environ[app_paths.LIBRARY_ENV] = args.library
    if not args.no_viewer:
        start_background_viewer()

    from director import mcp_server  # after the library folder is set: it is read on import

    mcp_server.main()
    return 0


# The background viewer's lock and server. Kept here: if the lock were garbage
# collected its file would close and the OS would drop the lock.
_background: dict = {}


def start_background_viewer() -> str | None:
    """Serve the viewer from this process so the director's preview links work,
    unless a viewer already runs (then the links point at that one). Quiet: no stdout."""
    lock = serve.InstanceLock()
    if not lock.acquire():
        return None
    try:
        with contextlib.redirect_stdout(sys.stderr):
            server = serve.bind("127.0.0.1", int(os.environ.get("SPELLDIRECTOR_PORT", serve.DEFAULT_PORT)))
    except (OSError, SystemExit):
        lock.release()
        return None
    serve.Handler.log_message = lambda *a, **k: None
    url = f"http://localhost:{server.server_address[1]}/"
    lock.publish(url)
    _background.update(lock=lock, server=server)
    threading.Thread(target=server.serve_forever, name="viewer", daemon=True).start()
    return url


def stop_background_viewer() -> None:
    server, lock = _background.pop("server", None), _background.pop("lock", None)
    if server is not None:
        server.shutdown()
        server.server_close()
    if lock is not None:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())
