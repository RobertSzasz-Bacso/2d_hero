"""Skip-if-missing sample regressions and tape-measure lengths."""

import json
from pathlib import Path

import pytest

from hero.samples import SampleSkipped, check_samples
from hero.testkit.building import build_building
from hero.testkit.writers import obj_bytes

ROOT = Path(__file__).resolve().parents[3]


def test_empty_user_folder_skips(tmp_path: Path) -> None:
    user = tmp_path / "user"
    user.mkdir()
    with pytest.raises(SampleSkipped) as caught:
        check_samples(user)
    assert str(user / "manifest.json") in str(caught.value)


def test_missing_sample_file_skips_with_its_path(tmp_path: Path) -> None:
    folder = tmp_path / "public"
    folder.mkdir()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "samples": [
                    {
                        "file": "Duplex_A_20110907.ifc",
                        "source": "public",
                        "kind": "ifc",
                        "notes": "",
                        "levels": 2,
                        "references": [],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(SampleSkipped) as caught:
        check_samples(folder, manifest=manifest, source="public")
    assert str(folder / "Duplex_A_20110907.ifc") in str(caught.value)


def test_reference_length_matches_a_known_wall(tmp_path: Path) -> None:
    folder = tmp_path / "user"
    folder.mkdir()
    (folder / "building.obj").write_bytes(obj_bytes(build_building(1)))
    (folder / "manifest.json").write_text(
        json.dumps(
            {
                "samples": [
                    {
                        "file": "building.obj",
                        "source": "user",
                        "kind": "mesh",
                        "notes": "South exterior centerline is 8 m.",
                        "levels": 2,
                        "references": [{"name": "south external wall", "lengthM": 8.0}],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    check_samples(folder)


def test_user_samples_skip_or_pass() -> None:
    folder = ROOT / "samples" / "user"
    manifest = folder / "manifest.json"
    source = None
    if not manifest.is_file():
        manifest = ROOT / "samples" / "manifest.example.json"
        source = "user"
    try:
        check_samples(folder, manifest=manifest, source=source)
    except SampleSkipped as exc:
        pytest.skip(str(exc))


def test_public_samples_skip_or_pass() -> None:
    folder = ROOT / "samples" / "public"
    manifest = folder / "manifest.json"
    source = None
    if not manifest.is_file():
        manifest = ROOT / "samples" / "manifest.example.json"
        source = "public"
    try:
        check_samples(folder, manifest=manifest, source=source)
    except SampleSkipped as exc:
        pytest.skip(str(exc))
