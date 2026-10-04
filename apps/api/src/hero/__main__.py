"""Start the API on 127.0.0.1 and, unless asked not to, open the browser."""

import argparse
import asyncio
import logging
import secrets
import socket
import webbrowser

import uvicorn
from fastapi import FastAPI

from hero.app import create_app
from hero.paths import app_config_dir, default_session_file, web_dist
from hero.session_file import write_token

logger = logging.getLogger("hero")


def main(argv: list[str] | None = None) -> None:
    """Bind the local server and open the browser at the session fragment."""
    parser = argparse.ArgumentParser(prog="hero")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Serve without opening a browser. Used by scripts/dev.ps1.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    token = secrets.token_urlsafe(32)
    config_dir = app_config_dir()
    session_file = default_session_file()
    write_token(config_dir / "session.token", token)
    write_token(session_file, token)
    logger.info("Session token stored")

    app = create_app(
        token=token,
        config_dir=config_dir,
        session_file=session_file,
        dist_dir=web_dist(),
    )
    port = _choose_port(args.port)
    if not web_dist().is_dir():
        logger.info("No web build at apps/web/dist; serving the API only")
    logger.info("Listening on http://127.0.0.1:%s", port)
    _serve(app, port=port, open_browser=not args.no_browser, token=token)


def _choose_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No free TCP port from {start} through {start + 19}.")


def _serve(app: FastAPI, *, port: int, open_browser: bool, token: str) -> None:
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    server = uvicorn.Server(config)

    async def open_when_ready() -> None:
        while not server.started:
            await asyncio.sleep(0.05)
        if open_browser:
            webbrowser.open(f"http://127.0.0.1:{port}/#t={token}")

    async def runner() -> None:
        await asyncio.gather(server.serve(), open_when_ready())

    asyncio.run(runner())


if __name__ == "__main__":
    main()
