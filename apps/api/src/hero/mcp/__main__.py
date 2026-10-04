"""stdio entry: python -m hero.mcp <project-dir>."""

from hero.mcp.server import server


def main() -> None:
    """Serve plan tools on stdin and stdout. Logs stay off this stream."""
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
