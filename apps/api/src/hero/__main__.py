"""Start the API on 127.0.0.1 and, unless asked not to, open the browser."""

import argparse
import asyncio
import logging
import os
import secrets
import socket
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from hero.app import create_app
from hero.dialogs import ask_open_file
from hero.hosted import HostedConfig, HostedConfigError
from hero.paths import app_config_dir, default_projects_dir, default_session_file, web_dist
from hero.session_file import write_token

logger = logging.getLogger("hero")


def main(argv: list[str] | None = None) -> None:
    """Bind the local server and open the browser at the session fragment."""
    parser = argparse.ArgumentParser(prog="hero")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--projects-dir", type=Path, default=None)
    parser.add_argument("--config-dir", type=Path, default=None)
    parser.add_argument("--session-file", type=Path, default=None)
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Serve without opening a browser. Used by scripts/dev.ps1.",
    )
    parser.add_argument(
        "--fake-agent",
        action="store_true",
        help="Use an in-memory key and a scripted agent. Browser tests only.",
    )
    parser.add_argument(
        "--hosted",
        action="store_true",
        help="Run behind Trimble Connect. Settings come from HERO_HOSTED_* and HERO_TRIMBLE_*.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind address. Only used with --hosted, for a reverse proxy that terminates HTTPS.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.hosted:
        _run_hosted(args)
        return
    token = secrets.token_urlsafe(32)
    config_dir = args.config_dir.resolve() if args.config_dir else app_config_dir()
    projects_dir = args.projects_dir.resolve() if args.projects_dir else default_projects_dir()
    session_file = args.session_file.resolve() if args.session_file else default_session_file()
    write_token(config_dir / "session.token", token)
    write_token(session_file, token)
    logger.info("Session token stored")

    agent = None
    ask = None
    if args.fake_agent:
        from hero.ai.fake import e2e_agent, e2e_ask

        agent = e2e_agent()
        ask = e2e_ask
    app = create_app(
        token=token,
        config_dir=config_dir,
        projects_dir=projects_dir,
        session_file=session_file,
        dist_dir=web_dist(),
        open_file=ask_open_file,
        agent=agent,
        ask=ask,
    )
    port = _choose_port(args.port)
    if not web_dist().is_dir():
        logger.info("No web build at apps/web/dist; serving the API only")
    logger.info("Listening on http://127.0.0.1:%s", port)
    _serve(app, port=port, open_browser=not args.no_browser, token=token)


def _run_hosted(args: argparse.Namespace) -> None:
    """Serve the hosted app. No session file, no browser, no local token."""
    try:
        hosted = HostedConfig.from_env(os.environ)
    except HostedConfigError as exc:
        raise SystemExit(f"Hosted mode is not configured. {exc}") from None
    projects_dir = args.projects_dir.resolve() if args.projects_dir else default_projects_dir()
    config_dir = args.config_dir.resolve() if args.config_dir else app_config_dir()
    app = create_app(
        token=secrets.token_urlsafe(32),
        config_dir=config_dir,
        projects_dir=projects_dir,
        dist_dir=web_dist(),
        hosted=hosted,
    )
    logger.info("Hosted mode on %s:%s for %s", args.host, args.port, hosted.public_url)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info", proxy_headers=False)


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
