"""Trimble's own file-service hosts are always allowed, so every project file can be imported.

Trimble serves signed downloads from regional hosts such as
``eu-aws-ro.fileservice.trimblecloud.com``. Any other host still needs the allow-list setting.
"""

import pytest

from hero.download import DownloadRejected, check_url

TRIMBLE_HOSTS = [
    "eu-aws-ro.fileservice.trimblecloud.com",
    "us-aws-rw.fileservice.trimblecloud.com",
    "ap-aws-ro.fileservice.trimblecloud.com",
    "EU-AWS-RO.FileService.TrimbleCloud.com",
]


@pytest.mark.parametrize("host", TRIMBLE_HOSTS)
def test_trimble_file_service_hosts_pass_with_an_empty_allow_list(host: str) -> None:
    found, url = check_url(f"https://{host}/files/abc?sig=secret", ())

    assert found == host.lower()
    assert url.startswith("https://")


@pytest.mark.parametrize(
    "host",
    [
        "fileservice.trimblecloud.com",
        "trimblecloud.com",
        "evilfileservice.trimblecloud.com",
        "eu.fileservice.trimblecloud.com.evil.test",
        "fileservice.trimblecloud.com.evil.test",
        "eu-aws-ro.fileservice-trimblecloud.com",
        "eu-aws-ro.fileservice.trimblecloud.com.",
        "files.example.test",
    ],
)
def test_lookalike_and_other_hosts_are_still_rejected(host: str) -> None:
    with pytest.raises(DownloadRejected) as caught:
        check_url(f"https://{host}/files/abc", ())

    assert "not allowed" in str(caught.value)


@pytest.mark.parametrize(
    "url",
    [
        "http://eu-aws-ro.fileservice.trimblecloud.com/f",
        "https://eu-aws-ro.fileservice.trimblecloud.com:8443/f",
        "https://user:pw@eu-aws-ro.fileservice.trimblecloud.com/f",
    ],
)
def test_trimble_hosts_still_need_https_port_443_and_no_credentials(url: str) -> None:
    with pytest.raises(DownloadRejected):
        check_url(url, ())


def test_a_configured_host_still_works_next_to_the_built_in_ones() -> None:
    found, _ = check_url("https://files.example.test/f", ("files.example.test",))

    assert found == "files.example.test"
