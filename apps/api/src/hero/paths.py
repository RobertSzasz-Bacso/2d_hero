"""Filesystem locations owned by the API process."""

from pathlib import Path

from platformdirs import user_config_dir, user_documents_dir


def api_root() -> Path:
    """Directory that contains pyproject.toml for the API."""
    return Path(__file__).resolve().parents[2]


def repo_root() -> Path:
    """Repository root, two levels above apps/api."""
    return api_root().parents[1]


def web_dist() -> Path:
    """Built browser app. Absent until the web package has been built."""
    return repo_root() / "apps" / "web" / "dist"


def default_session_file() -> Path:
    """Git-ignored token file the Vite dev proxy reads."""
    return api_root() / ".session-token"


def default_projects_dir() -> Path:
    """One folder per project. On Windows this is ``Documents\\2D Hero``."""
    return Path(user_documents_dir()) / "2D Hero"


def app_config_dir() -> Path:
    """Settings and session token directory.

    On Windows this is ``%APPDATA%\\2D Hero`` because ``roaming=True`` selects
    the roaming config folder. ``appauthor=False`` keeps the app name as the
    only extra directory.
    """
    return Path(user_config_dir("2D Hero", appauthor=False, roaming=True))
