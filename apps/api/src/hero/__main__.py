"""Run the local API. Serves the built web UI when apps/web/dist exists."""

import os

import uvicorn

from hero.main import app


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("HERO_PORT", "8000")))


if __name__ == "__main__":
    main()
