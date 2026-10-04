"""In-memory keyring backend. Tests inject this and never touch Windows Credential Manager."""

from keyring.backend import KeyringBackend
from keyring.compat import properties
from keyring.errors import PasswordDeleteError


class MemoryKeyring(KeyringBackend):
    """Process-local password store with the keyring backend interface."""

    def __init__(self) -> None:
        super().__init__()
        self.saved: dict[tuple[str, str], str] = {}

    @properties.classproperty
    def priority(cls) -> float:  # noqa: N805
        raise RuntimeError("In-memory keyring is for tests only.")

    def get_password(self, service: str, username: str) -> str | None:
        return self.saved.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.saved[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        try:
            del self.saved[(service, username)]
        except KeyError as exc:
            raise PasswordDeleteError(username) from exc
