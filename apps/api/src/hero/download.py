"""Hosted downloads: check a Trimble download URL, then stream it to disk.

The URL is a secret: it is signed, and its query string grants access to the file. Nothing here
logs it, stores it, or puts it in an error. The Trimble access token is never seen by this module.
"""

import asyncio
import ipaddress
import logging
import re
import socket
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from urllib.parse import urljoin, urlsplit

import httpx

logger = logging.getLogger("hero.download")


def silence_url_loggers() -> None:
    """httpx logs every request URL at INFO, query string included. Signed URLs are secrets."""
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)


silence_url_loggers()

# The import types in docs/plan-schema.md (`format`) plus the USD variants the reader opens.
SUPPORTED_EXTENSIONS = frozenset(
    {
        ".obj", ".glb", ".gltf", ".usdz", ".usd", ".usda", ".usdc",
        ".ply", ".e57", ".las", ".laz", ".ifc",
    }  # fmt: skip
)
MAX_REDIRECTS = 3
CONNECT_TIMEOUT_S = 10.0
READ_TIMEOUT_S = 60.0
_TRANSFER_ID = re.compile(r"^[0-9a-f]{32}$")

Resolver = Callable[[str], list[str]]


class DownloadRejected(Exception):
    """The request breaks a URL rule. The message is safe to show: it holds no URL."""


class DownloadFailed(Exception):
    """The remote side did not deliver the file."""


class DownloadCancelled(Exception):
    """The user cancelled the transfer."""


class DownloadTooLarge(Exception):
    """The file is over the hosted size limit."""


def system_resolver(host: str) -> list[str]:
    """Every address the name resolves to."""
    infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


def check_file_name(name: str) -> str:
    """The extension decides whether the import can read the file. Returns the base name."""
    base = PurePosixPath(name.replace("\\", "/")).name
    if not base or PurePosixPath(base).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise DownloadRejected("This file type cannot be imported.")
    return base


def _is_public(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    return parsed.is_global


def check_url(url: str, hosts: tuple[str, ...]) -> tuple[str, str]:
    """Return ``(host, url)`` for a URL that passes the static rules, else ``DownloadRejected``."""
    try:
        parts = urlsplit(url)
        port = parts.port
        host = (parts.hostname or "").lower()
    except ValueError:
        raise DownloadRejected("The download link is not valid.") from None
    if parts.scheme != "https":
        raise DownloadRejected("Only https download links are accepted.")
    if parts.username is not None or parts.password is not None:
        raise DownloadRejected("The download link must not contain credentials.")
    if not host or port not in (None, 443):
        raise DownloadRejected("The download link is not valid.")
    if host not in hosts:
        # The host name is not secret (the query string is). Naming it lets the owner allow-list it.
        raise DownloadRejected(f"That download host is not allowed: {host}")
    return host, url


async def check_host(host: str, resolve: Resolver) -> None:
    """Every address the host resolves to must be public."""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not _is_public(host):
            raise DownloadRejected("That download host is not allowed.")
        return
    try:
        addresses = await asyncio.to_thread(resolve, host)
    except OSError:
        raise DownloadFailed("The download host could not be reached.") from None
    if not addresses or not all(_is_public(address) for address in addresses):
        raise DownloadRejected("That download host is not allowed.")


@dataclass
class Transfer:
    """Progress for one download. ``bytes`` counts what is on disk so far."""

    bytes: int = 0
    total: int | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)

    def snapshot(self) -> dict[str, object]:
        return {"state": "running", "bytes": self.bytes, "total": self.total}


class Transfers:
    """The downloads in flight, by client-chosen id. Finished ones are forgotten."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, Transfer] = {}

    @staticmethod
    def valid_id(value: str) -> bool:
        return _TRANSFER_ID.fullmatch(value) is not None

    def begin(self, transfer_id: str) -> Transfer:
        with self._lock:
            if transfer_id in self._items:
                raise DownloadRejected("That transfer is already running.")
            transfer = Transfer()
            self._items[transfer_id] = transfer
            return transfer

    def get(self, transfer_id: str) -> Transfer | None:
        with self._lock:
            return self._items.get(transfer_id)

    def cancel(self, transfer_id: str) -> bool:
        transfer = self.get(transfer_id)
        if transfer is None:
            return False
        transfer.cancelled.set()
        return True

    def end(self, transfer_id: str) -> None:
        with self._lock:
            self._items.pop(transfer_id, None)


@asynccontextmanager
async def open_download(
    url: str,
    hosts: tuple[str, ...],
    *,
    transport: httpx.AsyncBaseTransport | None,
    resolve: Resolver,
) -> AsyncIterator[httpx.Response]:
    """Open the response for ``url``. Redirects stay on the first host and are checked again."""
    silence_url_loggers()
    host, current = check_url(url, hosts)
    await check_host(host, resolve)
    timeout = httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S)
    async with httpx.AsyncClient(
        transport=transport, follow_redirects=False, timeout=timeout, trust_env=False
    ) as client:
        response: httpx.Response | None = None
        for _hop in range(MAX_REDIRECTS + 1):
            request = client.build_request(
                "GET", current, headers={"Accept-Encoding": "identity"}
            )
            try:
                response = await client.send(request, stream=True)
            except httpx.HTTPError:
                raise DownloadFailed("The file could not be downloaded.") from None
            if response.status_code not in (301, 302, 303, 307, 308):
                break
            location = response.headers.get("location")
            await response.aclose()
            response = None
            if not location:
                raise DownloadFailed("The file could not be downloaded.")
            current = urljoin(current, location)
            next_host, current = check_url(current, hosts)
            if next_host != host:
                raise DownloadRejected("The download redirected to another host.")
        if response is None:
            raise DownloadFailed("The download redirected too many times.")
        try:
            if response.status_code != 200:
                raise DownloadFailed("The file could not be downloaded.")
            yield response
        finally:
            await response.aclose()


def declared_size(response: httpx.Response) -> int | None:
    value = response.headers.get("content-length")
    if value is not None and value.isdigit():
        return int(value)
    return None


def chunk_reader(
    response: httpx.Response, transfer: Transfer
) -> Callable[[int], Awaitable[bytes]]:
    """A ``read(n)`` for ``create_from_chunks`` that counts bytes and honours cancel."""
    chunks = response.aiter_bytes()

    async def read(_size: int) -> bytes:
        if transfer.cancelled.is_set():
            raise DownloadCancelled
        try:
            chunk = await anext(chunks)
        except StopAsyncIteration:
            return b""
        except httpx.HTTPError:
            raise DownloadFailed("The file could not be downloaded.") from None
        if transfer.cancelled.is_set():
            raise DownloadCancelled
        transfer.bytes += len(chunk)
        return chunk

    return read
