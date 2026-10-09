"""Identification uses the screenshot from the user's 3D view."""

import base64
import io
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from hero.ai.viewshot import ViewShot
from hero.keystore import set_cursor_key

SECRET = "crsr_test_key_do_not_log"


def _headers(token: str) -> dict[str, str]:
    return {"X-Hero-Token": token}


def test_top_view_puts_the_high_plan_y_at_the_top_of_the_picture() -> None:
    from hero.ai.topview import render_top_view

    points = np.array([[0.0, 0.0, 0.0], [0.0, 2.0, 0.0]], dtype=np.float32)
    colors = np.array([[255, 0, 0], [0, 0, 255]], dtype=np.uint8)
    png, frame = render_top_view(points, colors, size=64)
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert frame.min_y < 0.0
    assert frame.max_y > 2.0
    image = np.asarray(Image.open(io.BytesIO(png)))
    red_rows = np.argwhere((image[:, :, 0] > 200) & (image[:, :, 2] < 40))[:, 0]
    blue_rows = np.argwhere((image[:, :, 2] > 200) & (image[:, :, 0] < 40))[:, 0]
    assert len(red_rows) > 0
    assert len(blue_rows) > 0
    assert blue_rows.mean() < red_rows.mean()


def test_top_view_puts_the_high_plan_x_on_the_right() -> None:
    from hero.ai.topview import render_top_view

    points = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]], dtype=np.float32)
    colors = np.array([[255, 0, 0], [0, 255, 0]], dtype=np.uint8)
    png, _frame = render_top_view(points, colors, size=64)
    image = np.asarray(Image.open(io.BytesIO(png)))
    red_cols = np.argwhere((image[:, :, 0] > 200) & (image[:, :, 1] < 40))[:, 1]
    green_cols = np.argwhere((image[:, :, 1] > 200) & (image[:, :, 0] < 40))[:, 1]
    assert len(red_cols) > 0
    assert len(green_cols) > 0
    assert green_cols.mean() > red_cols.mean()


def test_streamed_cursor_text_is_kept() -> None:
    from types import SimpleNamespace

    from hero.ai.chat import _observe

    chunks: list[str] = []
    notes: list[str] = []
    _observe(
        SimpleNamespace(
            sdk_message=None,
            interaction_update=SimpleNamespace(type="text-delta", text='{"fixtures":[]}'),
            result=None,
        ),
        chunks,
        notes,
    )
    assert chunks == ['{"fixtures":[]}']


def test_a_pause_does_not_cut_an_unfinished_fixture_list() -> None:
    from hero.ai.chat import _bounded_reply, _stop_for_quiet

    partial = '{"fixtures":[{"symbol":"bed-double","confidence":0.95'
    assert _stop_for_quiet(complete=True, quiet=2.0, text=partial) is False
    finished = partial + "}]}"
    assert _stop_for_quiet(complete=True, quiet=2.0, text=finished) is True
    assert _stop_for_quiet(complete=False, quiet=1.2, text=partial) is True
    long_reply = "x" * 4001
    assert _bounded_reply(long_reply, complete=True) == long_reply
    assert _bounded_reply(long_reply, complete=False).endswith("...")


def test_cursor_failure_report_names_the_model_and_hides_the_key() -> None:
    from hero.ai.chat import cursor_failure_report

    text = cursor_failure_report(
        model_label="gemini-3.7-flash effort=high",
        elapsed_s=1.2,
        alive=False,
        run_status="error",
        result="",
        notes=["status error: model is not available SECRET"],
        error="BadRequestError model rejected SECRET",
        api_key="SECRET",
    )
    assert "gemini-3.7-flash effort=high" in text
    assert "model is not available" in text
    assert "SECRET" not in text
    assert "[key]" in text


def test_furniture_detection_uses_gemini_flash_medium() -> None:
    pytest.importorskip("cursor_sdk")
    import sys

    import cursor_sdk
    from cursor_sdk import ModelParameterValue

    from hero.ai.chat import _vision_selection

    try:
        selection = _vision_selection(cursor_sdk)
        assert selection.id == "gemini-3.7-flash"
        assert selection.params == (ModelParameterValue(id="effort", value="medium"),)
    finally:
        for name in list(sys.modules):
            if name == "cursor_sdk" or name.startswith("cursor_sdk."):
                del sys.modules[name]


def test_screenshot_pixel_lands_on_the_floor_under_that_pixel() -> None:
    from hero.ai.viewshot import plan_xy

    shot = _overhead_shot()
    nx = (0.40209504759554227 + 1.0) / 2.0
    ny = (1.0 - (-0.1340316825318474)) / 2.0
    assert plan_xy(nx, ny, shot) == pytest.approx((1.5, -0.5))
    assert plan_xy(0.5, 0.5, shot) == pytest.approx((0.0, 0.0))
    top = plan_xy(0.5, 0.0, shot)
    bottom = plan_xy(0.5, 1.0, shot)
    assert top is not None and bottom is not None
    assert top[1] > bottom[1]


def test_fixture_json_uses_the_screenshot_camera() -> None:
    from hero.ai.identify import parse_fixtures
    from hero.ai.viewshot import plan_xy

    shot = _overhead_shot()
    nx = (0.40209504759554227 + 1.0) / 2.0
    ny = (1.0 - (-0.1340316825318474)) / 2.0
    reply = f"""```json
{{"fixtures":[
  {{"symbol":"toilet","nx":{nx},"ny":{ny},"spanX":0.04,"spanY":0.08,"back":"left","confidence":0.9}},
  {{"symbol":"bathtub","nx":0.5,"ny":0.5,"spanX":0.2,"spanY":0.05,"back":"left","confidence":0.8}},
  {{"symbol":"spaceship","nx":0.5,"ny":0.5,"spanX":0.1,"spanY":0.1,"back":"up","confidence":1}}
]}}
```"""
    found = parse_fixtures(reply, shot)
    assert [(item.symbol, item.x, item.y) for item in found] == [
        ("toilet", pytest.approx(1.5), pytest.approx(-0.5)),
        ("bathtub", pytest.approx(0.0), pytest.approx(0.0)),
    ]
    assert found[0].rotation_deg == 90
    assert found[1].rotation_deg == 90
    assert found[0].role == "fixture"
    left = plan_xy(0.4, 0.5, shot)
    right = plan_xy(0.6, 0.5, shot)
    assert left is not None and right is not None
    assert found[1].depth == pytest.approx(abs(right[0] - left[0]), rel=0.05)
    assert found[1].depth > 1.0


def test_identify_saves_fixtures_and_hides_the_key(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.app import create_app

    seen: dict[str, Any] = {}

    def see(prompt: str, png: bytes, api_key: str) -> str:
        seen["prompt"] = prompt
        seen["png"] = png
        seen["key"] = api_key
        seen["reply"] = json.dumps(
            {
                "fixtures": [
                    {
                        "symbol": "toilet",
                        "nx": 0.5,
                        "ny": 0.5,
                        "width": 0.4,
                        "depth": 0.7,
                        "rotationDeg": 0,
                        "confidence": 0.85,
                    }
                ]
            }
        )
        return seen["reply"]

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        see=see,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=_shot_body(),
        )
    assert response.status_code == 200
    body = response.json()
    assert body["cursorKeySet"] is True
    fixture = body["plan"]["levels"][0]["fixtures"][0]
    assert fixture["symbol"] == "toilet"
    assert fixture["role"] == "fixture"
    assert fixture["x"] == pytest.approx(0.0)
    assert fixture["y"] == pytest.approx(0.0)
    assert body["plan"]["levels"][0]["walls"][0]["thickness"] == 0.2
    assert body["plan"]["revision"] == 2
    saved = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
    assert saved["levels"][0]["fixtures"][0]["symbol"] == "toilet"
    assert seen["key"] == SECRET
    assert SECRET not in response.text
    assert SECRET not in seen["prompt"]
    assert "The back of a toilet is the rectangular tank" in seen["prompt"]
    assert "spanX" in seen["prompt"]
    assert "Do not report metres or degrees." in seen["prompt"]
    assert seen["png"].startswith(b"\x89PNG\r\n\x1a\n")
    assert (folder / "identification.png").read_bytes() == seen["png"]
    assert (folder / "identification-prompt.txt").read_text(encoding="utf-8") == seen["prompt"]
    assert SECRET not in (folder / "identification-prompt.txt").read_text(encoding="utf-8")
    assert (folder / "identification-reply.txt").read_text(encoding="utf-8") == seen["reply"]
    assert SECRET not in (folder / "identification-reply.txt").read_text(encoding="utf-8")


def test_mask_identification_uses_the_framed_overhead_view(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.ai.mask import MASK_PALETTE
    from hero.app import create_app

    mask_image = Image.new("RGB", (300, 240), MASK_PALETTE["floor"])
    ImageDraw.Draw(mask_image).rectangle((0, 80, 50, 140), fill=MASK_PALETTE["toilet"])
    mask_buffer = io.BytesIO()
    mask_image.save(mask_buffer, format="PNG")
    mask_base64 = base64.b64encode(mask_buffer.getvalue()).decode("ascii")
    seen: dict[str, Any] = {}

    def make_mask(prompt: str, screenshot: bytes, overhead: bytes, api_key: str) -> bytes:
        seen["prompt"] = prompt
        seen["screenshot"] = screenshot
        seen["overhead"] = overhead
        seen["key"] = api_key
        return mask_buffer.getvalue()

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        mask=make_mask,
    )
    body = _shot_body()
    body["overheadImage"] = mask_base64
    body["overheadFrame"] = [0.0, 0.0, 5.0, 0.0, 0.0, 3.0]
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=body,
        )

    assert response.status_code == 200
    fixture = response.json()["plan"]["levels"][0]["fixtures"][0]
    assert fixture["symbol"] == "toilet"
    assert fixture["x"] == pytest.approx(0.42, abs=0.04)
    assert fixture["y"] == pytest.approx(1.62, abs=0.04)
    assert seen["screenshot"].startswith(b"\x89PNG\r\n\x1a\n")
    assert seen["overhead"].startswith(b"\x89PNG\r\n\x1a\n")
    assert "SVG" in seen["prompt"]
    assert (folder / "identification-overhead.png").is_file()
    assert (folder / "identification-mask.png").is_file()


def test_identify_uses_scan_geometry_before_cursor(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.app import create_app
    from hero.testkit.building import build_building
    from hero.testkit.writers import obj_bytes

    source = tmp_path / "bathroom.obj"
    source.write_bytes(obj_bytes(build_building(1, furniture="bathroom")))
    calls: list[str] = []

    def should_not_place(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        calls.append("place")
        raise AssertionError("Cursor must not place measured furniture")

    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        see=should_not_place,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "Bathroom"},
            headers=_headers(token),
        )
        assert created.status_code == 200
        project_id = created.json()["id"]
        saved = client.put(
            f"/api/projects/{project_id}/plan",
            json=_wall_plan(),
            headers={**_headers(token), "If-Match": "0"},
        )
        assert saved.status_code == 200
        body = _shot_body()
        body["overheadImage"] = body["image"]
        body["overheadFrame"] = [0.0, 0.0, 8.0, 0.0, 0.0, 6.0]
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=body,
        )

    assert response.status_code == 200, response.text
    assert "plan" in response.json(), response.text
    fixtures = response.json()["plan"]["levels"][0]["fixtures"]
    assert {fixture["symbol"] for fixture in fixtures} == {"toilet", "sink"}
    assert calls == []


def test_point_cloud_without_geometry_falls_back_to_cursor_mask(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.ai.mask import MASK_PALETTE
    from hero.app import create_app
    from hero.testkit.building import build_building
    from hero.testkit.writers import obj_bytes

    source = tmp_path / "bare.obj"
    source.write_bytes(obj_bytes(build_building(1, furniture="bare")))
    mask_image = Image.new("RGB", (300, 240), MASK_PALETTE["floor"])
    ImageDraw.Draw(mask_image).rectangle((0, 80, 50, 140), fill=MASK_PALETTE["toilet"])
    mask_buffer = io.BytesIO()
    mask_image.save(mask_buffer, format="PNG")
    seen: dict[str, Any] = {}

    def make_mask(prompt: str, screenshot: bytes, overhead: bytes, api_key: str) -> bytes:
        seen["prompt"] = prompt
        seen["screenshot"] = screenshot
        seen["overhead"] = overhead
        seen["key"] = api_key
        return mask_buffer.getvalue()

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        mask=make_mask,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "Bare scan"},
            headers=_headers(token),
        )
        assert created.status_code == 200
        project_id = created.json()["id"]
        saved = client.put(
            f"/api/projects/{project_id}/plan",
            json=_wall_plan(),
            headers={**_headers(token), "If-Match": "0"},
        )
        assert saved.status_code == 200
        body = _shot_body()
        body["overheadImage"] = body["image"]
        body["overheadFrame"] = [0.0, 0.0, 5.0, 0.0, 0.0, 3.0]
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=body,
        )

    assert response.status_code == 200, response.text
    fixtures = response.json()["plan"]["levels"][0]["fixtures"]
    assert [fixture["symbol"] for fixture in fixtures] == ["toilet"]
    assert seen["screenshot"].startswith(b"\x89PNG\r\n\x1a\n")
    assert seen["overhead"].startswith(b"\x89PNG\r\n\x1a\n")


def test_cursor_labels_ambiguous_geometry_without_changing_measurements(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.app import create_app
    from hero.testkit.building import build_building
    from hero.testkit.writers import obj_bytes

    source = tmp_path / "block.obj"
    source.write_bytes(obj_bytes(build_building(1, furniture="block")))
    seen: dict[str, Any] = {}

    def label(prompt: str, pictures: list[bytes], api_key: str) -> str:
        seen["prompt"] = prompt
        seen["pictures"] = pictures
        seen["key"] = api_key
        return (
            '{"labels":[{"id":"f1","symbol":"table","x":999,"y":999,'
            '"width":999,"depth":999}]}'
        )

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        label=label,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "Block"},
            headers=_headers(token),
        )
        assert created.status_code == 200
        project_id = created.json()["id"]
        saved = client.put(
            f"/api/projects/{project_id}/plan",
            json=_wall_plan(),
            headers={**_headers(token), "If-Match": "0"},
        )
        assert saved.status_code == 200
        body = _shot_body()
        body["overheadImage"] = body["image"]
        body["overheadFrame"] = [0.0, 0.0, 8.0, 0.0, 0.0, 6.0]
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=body,
        )

    assert response.status_code == 200, response.text
    fixture = response.json()["plan"]["levels"][0]["fixtures"][0]
    assert fixture["symbol"] == "table"
    assert fixture["x"] == pytest.approx(2.0, abs=0.05)
    assert fixture["y"] == pytest.approx(3.0, abs=0.05)
    assert fixture["width"] == pytest.approx(0.5, abs=0.05)
    assert fixture["depth"] == pytest.approx(0.5, abs=0.05)
    assert "x=" not in seen["prompt"]
    assert len(seen["pictures"]) == 2


def test_a_missed_camera_hit_is_reported_and_not_moved() -> None:
    from shapely.geometry import box

    from hero.ai.identify import parse_fixtures, placement_report
    from hero.ai.room import RoomBounds

    bounds = RoomBounds(
        polygon=box(10.0, 10.0, 14.0, 13.0),
        width=4.0,
        depth=3.0,
        area=12.0,
        min_x=10.0,
        min_y=10.0,
        max_x=14.0,
        max_y=13.0,
    )
    text = json.dumps(
        {
            "fixtures": [
                {
                    "symbol": "table",
                    "nx": 0.5,
                    "ny": 0.5,
                    "spanX": 0.1,
                    "spanY": 0.2,
                    "back": "up",
                    "confidence": 0.8,
                }
            ]
        }
    )
    found = parse_fixtures(text, _overhead_shot())
    assert found[0].x == pytest.approx(0.0)
    assert found[0].y == pytest.approx(0.0)
    report = placement_report(text, _overhead_shot(), bounds)
    assert "table" in report
    assert "outside" in report


def test_a_short_scan_becomes_a_rectangular_room() -> None:
    from hero.ai.room import measure_cloud
    from hero.pipeline.normalize import LevelSlice, Normalized

    xs, ys = np.meshgrid(np.linspace(0.0, 2.0, 8), np.linspace(0.0, 1.0, 6))
    points = np.column_stack(
        [xs.ravel(), ys.ravel(), np.full(xs.size, 0.4)]
    ).astype(np.float64)
    cloud = Normalized(
        points=points,
        normals=np.tile([0.0, 1.0, 0.0], (len(points), 1)),
        unit_scale=1.0,
        voxel=0.02,
        estimated_up=np.array([0.0, 0.0, 1.0]),
        levels=[LevelSlice(0.0, 2.7)],
        manhattan_angle_deg=0.0,
    )
    level, bounds = measure_cloud(cloud)
    assert len(level.walls) == 4
    assert bounds.area == pytest.approx(2.0, abs=0.02)
    assert bounds.width == pytest.approx(2.0, abs=0.02)
    assert bounds.depth == pytest.approx(1.0, abs=0.02)


def test_furniture_outside_the_room_is_reported_and_not_resized() -> None:
    from hero.ai.room import outside_messages

    bounds = _room_box()
    inside = _fixture("bed-double", 2.0, 1.5, 1.6, 2.0)
    edge = _fixture("sink", 4.02, 1.5, 0.04, 0.4)
    fat = _fixture("sofa", 3.9, 1.5, 1.0, 0.6)
    outside = _fixture("table", 8.0, 8.0, 1.2, 0.8)
    report = " ".join(outside_messages([inside, edge, fat, outside], bounds))
    assert "bed-double" not in report
    assert "sink" not in report
    assert "sofa" in report
    assert "table" in report
    assert fat.width == 1.0
    assert outside.x == 8.0


def test_cursor_must_correct_a_placement_before_anything_is_saved(
    tmp_path: Path,
) -> None:
    from hero.ai.identify import IdentifyError, identify_project
    from hero.atomic import atomic_write_text
    from hero.pipeline.cloud import write_cloud
    from hero.pipeline.normalize import LevelSlice, Normalized
    from hero.projects import ProjectStore
    from hero.schema import Level, Plan, dump_plan

    source = tmp_path / "room.glb"
    source.write_bytes(b"link")
    store = ProjectStore(tmp_path / "projects", tmp_path / "config")
    created = store.create_linked(str(source), "Room")
    folder = store.project_dir(created.id)
    plan = Plan.model_validate_json((folder / "plan.json").read_text(encoding="utf-8"))
    plan.levels = [Level(id="L1", name="Level 1", elevation=0, ceilingHeight=2.7)]
    atomic_write_text(folder / "plan.json", dump_plan(plan))
    xs, ys = np.meshgrid(np.linspace(-1.0, 1.0, 6), np.linspace(-0.5, 0.5, 4))
    points = np.column_stack([xs.ravel(), ys.ravel(), np.zeros(xs.size)])
    write_cloud(
        folder / "cloud.bin",
        Normalized(
            points=points,
            normals=np.tile([0.0, 0.0, 1.0], (len(points), 1)),
            unit_scale=1.0,
            voxel=0.02,
            estimated_up=np.array([0.0, 0.0, 1.0]),
            levels=[LevelSlice(0.0, 2.7)],
            manhattan_angle_deg=0.0,
        ),
    )
    outside = json.dumps(
        {
            "fixtures": [
                {
                    "symbol": "table",
                    "nx": 0.99,
                    "ny": 0.5,
                    "spanX": 0.04,
                    "spanY": 0.04,
                    "back": "up",
                    "confidence": 0.8,
                }
            ]
        }
    )
    inside = json.dumps(
        {
            "fixtures": [
                {
                    "symbol": "table",
                    "nx": 0.5,
                    "ny": 0.5,
                    "width": 0.4,
                    "depth": 0.4,
                    "rotationDeg": 0,
                    "confidence": 0.9,
                }
            ]
        }
    )

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        return outside

    def correct(error: str) -> str:
        assert "table" in error
        assert "outside" in error
        saved = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
        assert saved["levels"][0]["walls"] == []
        assert saved["levels"][0]["fixtures"] == []
        return inside

    updated = identify_project(
        store,
        created.id,
        "key",
        image=_shot_body()["image"],
        projection=_shot_body()["projection"],
        matrix_world=_shot_body()["matrixWorld"],
        floor_z=0.0,
        see=see,
        correct=correct,
    )
    assert updated.levels[0].walls
    assert [item.symbol for item in updated.levels[0].fixtures] == ["table"]

    def still_wrong(error: str) -> str:
        del error
        return outside

    with pytest.raises(IdentifyError, match="outside"):
        identify_project(
            store,
            created.id,
            "key",
            image=_shot_body()["image"],
            projection=_shot_body()["projection"],
            matrix_world=_shot_body()["matrixWorld"],
            floor_z=0.0,
            see=see,
            correct=still_wrong,
        )
    saved = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
    assert [item["symbol"] for item in saved["levels"][0]["fixtures"]] == ["table"]


def test_each_detection_stores_the_whole_conversation(tmp_path: Path) -> None:
    from hero.ai.identify import identify_project, review_placement
    from hero.atomic import atomic_write_text
    from hero.pipeline.cloud import write_cloud
    from hero.pipeline.normalize import LevelSlice, Normalized
    from hero.projects import ProjectStore
    from hero.schema import Level, Plan, dump_plan

    source = tmp_path / "room.glb"
    source.write_bytes(b"link")
    store = ProjectStore(tmp_path / "projects", tmp_path / "config")
    created = store.create_linked(str(source), "Room")
    folder = store.project_dir(created.id)
    plan = Plan.model_validate_json((folder / "plan.json").read_text(encoding="utf-8"))
    plan.levels = [Level(id="L1", name="Level 1", elevation=0, ceilingHeight=2.7)]
    atomic_write_text(folder / "plan.json", dump_plan(plan))
    xs, ys = np.meshgrid(np.linspace(-1.0, 1.0, 6), np.linspace(-0.5, 0.5, 4))
    points = np.column_stack([xs.ravel(), ys.ravel(), np.zeros(xs.size)])
    write_cloud(
        folder / "cloud.bin",
        Normalized(
            points=points,
            normals=np.tile([0.0, 0.0, 1.0], (len(points), 1)),
            unit_scale=1.0,
            voxel=0.02,
            estimated_up=np.array([0.0, 0.0, 1.0]),
            levels=[LevelSlice(0.0, 2.7)],
            manhattan_angle_deg=0.0,
        ),
    )
    outside = json.dumps(
        {
            "fixtures": [
                {
                    "symbol": "table",
                    "nx": 0.99,
                    "ny": 0.5,
                    "spanX": 0.04,
                    "spanY": 0.04,
                    "back": "up",
                    "confidence": 0.8,
                }
            ]
        }
    )
    inside = json.dumps(
        {
            "fixtures": [
                {
                    "symbol": "table",
                    "nx": 0.5,
                    "ny": 0.5,
                    "width": 0.4,
                    "depth": 0.4,
                    "rotationDeg": 0,
                    "confidence": 0.9,
                }
            ]
        }
    )

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        return f"{outside}\n{SECRET}"

    def correct(error: str) -> str:
        del error
        return inside

    shot = _shot_body()
    identify_project(
        store,
        created.id,
        SECRET,
        image=shot["image"],
        projection=shot["projection"],
        matrix_world=shot["matrixWorld"],
        floor_z=0.0,
        see=see,
        correct=correct,
    )
    talks = sorted(path for path in (folder / "identification").iterdir() if path.is_dir())
    assert len(talks) == 1
    talk = talks[0]
    assert (talk / "01-image.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    prompt = (talk / "01-prompt.txt").read_text(encoding="utf-8")
    assert "Do not report metres or degrees." in prompt
    first_reply = (talk / "01-reply.txt").read_text(encoding="utf-8")
    assert "table" in first_reply
    assert "[key]" in first_reply
    assert SECRET not in first_reply
    assert "outside" in (talk / "02-error.txt").read_text(encoding="utf-8")
    assert "table" in (talk / "02-reply.txt").read_text(encoding="utf-8")

    def check(prompt: str, original: bytes, plan_png: bytes, api_key: str) -> str:
        del prompt, original, plan_png, api_key
        return '{"ok": true}'

    review_placement(store, created.id, SECRET, image=shot["image"], check=check)
    assert "2D plan" in (talk / "03-prompt.txt").read_text(encoding="utf-8")
    assert (talk / "03-image.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert (talk / "03-plan.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert "ok" in (talk / "03-reply.txt").read_text(encoding="utf-8")
    assert SECRET not in "\n".join(
        path.read_text(encoding="utf-8") for path in talk.glob("*.txt")
    )

    identify_project(
        store,
        created.id,
        SECRET,
        image=shot["image"],
        projection=shot["projection"],
        matrix_world=shot["matrixWorld"],
        floor_z=0.0,
        see=lambda prompt, png, api_key: inside,
        correct=correct,
    )
    talks = sorted(path for path in (folder / "identification").iterdir() if path.is_dir())
    assert len(talks) == 2
    assert (talks[0] / "03-plan.png").is_file()
    assert (talks[1] / "01-prompt.txt").is_file()
    assert not (talks[1] / "03-plan.png").exists()


def test_prompt_tells_the_model_the_room_size() -> None:
    from shapely.geometry import box

    from hero.ai.identify import _prompt
    from hero.ai.room import RoomBounds

    bounds = RoomBounds(
        polygon=box(0.0, 0.0, 4.0, 3.0),
        width=4.0,
        depth=3.0,
        area=12.0,
        min_x=0.0,
        min_y=0.0,
        max_x=4.0,
        max_y=3.0,
    )
    text = _prompt(_overhead_shot(), bounds)
    assert "area is 12.00 m²" in text
    assert "x=0.00 m" in text
    assert "x=4.00 m" in text
    assert "Do not place anything outside the room." in text


def _room_box() -> Any:
    from shapely.geometry import box

    from hero.ai.room import RoomBounds

    return RoomBounds(
        polygon=box(0.0, 0.0, 4.0, 3.0),
        width=4.0,
        depth=3.0,
        area=12.0,
        min_x=0.0,
        min_y=0.0,
        max_x=4.0,
        max_y=3.0,
    )


def _fixture(symbol: str, x: float, y: float, width: float, depth: float) -> Any:
    from hero.ai.identify import ParsedFixture

    return ParsedFixture(symbol, x, y, 0.0, width, depth, 0.9, "furniture")


def test_the_plan_picture_is_sent_back_and_cursor_can_correct_it(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.app import create_app

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        return json.dumps(
            {
                "fixtures": [
                    {
                        "symbol": "toilet",
                        "nx": 0.5,
                        "ny": 0.5,
                        "spanX": 0.05,
                        "spanY": 0.08,
                        "back": "up",
                        "confidence": 0.8,
                    }
                ]
            }
        )

    seen: dict[str, Any] = {"calls": 0}

    def check(prompt: str, original: bytes, plan_png: bytes, api_key: str) -> str:
        del api_key
        seen["calls"] += 1
        seen["prompt"] = prompt
        seen["original"] = original
        seen["plan"] = plan_png
        if seen["calls"] == 1:
            return json.dumps(
                {
                    "fixtures": [
                        {
                            "symbol": "bathtub",
                            "nx": 0.3,
                            "ny": 0.4,
                            "spanX": 0.2,
                            "spanY": 0.15,
                            "back": "left",
                            "confidence": 0.9,
                        }
                    ]
                }
            )
        return '{"ok": true}'

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        see=see,
        check=check,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        first = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=_shot_body(),
        )
        assert first.status_code == 200
        assert first.json()["plan"]["levels"][0]["fixtures"][0]["symbol"] == "toilet"
        review = client.post(
            f"/api/projects/{project_id}/identify/review",
            headers=_headers(token),
            json={"image": _shot_body()["image"]},
        )
    assert review.status_code == 200
    body = review.json()
    assert body["accepted"] is False
    assert body["plan"]["levels"][0]["fixtures"][0]["symbol"] == "bathtub"
    assert "2D plan" in seen["prompt"]
    assert "too far from a wall" in seen["prompt"]
    assert seen["original"].startswith(b"\x89PNG\r\n\x1a\n")
    assert seen["plan"].startswith(b"\x89PNG\r\n\x1a\n")
    assert SECRET not in seen["prompt"]
    assert (folder / "identification-plan.png").read_bytes() == seen["plan"]
    saved = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
    assert saved["levels"][0]["fixtures"][0]["symbol"] == "bathtub"

    with TestClient(app, base_url="http://127.0.0.1") as client:
        again = client.post(
            f"/api/projects/{project_id}/identify/review",
            headers=_headers(token),
            json={"image": _shot_body()["image"]},
        )
    assert again.status_code == 200
    assert again.json()["accepted"] is True
    saved = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
    assert saved["levels"][0]["fixtures"][0]["symbol"] == "bathtub"


def test_identify_without_a_key_does_not_call_cursor(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.app import create_app

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        raise AssertionError("Cursor must not run without a saved key")

    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        see=see,
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        before = (folder / "plan.json").read_bytes()
        response = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=_shot_body(),
        )
    assert response.status_code == 200
    assert response.json()["cursorKeySet"] is False
    assert (folder / "plan.json").read_bytes() == before


def _overhead_shot() -> ViewShot:
    """Perspective camera 8 m above the origin, looking down. Screen up is plan +Y."""
    return ViewShot(
        projection=(
            2.1445069205095586,
            0,
            0,
            0,
            0,
            2.1445069205095586,
            0,
            0,
            0,
            0,
            -1.002002002002002,
            -1,
            0,
            0,
            -0.20020020020020018,
            0,
        ),
        matrix_world=(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 8, 1),
        floor_z=0.0,
    )


def _shot_body() -> dict[str, Any]:
    shot = _overhead_shot()
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (180, 140, 90)).save(buffer, format="PNG")
    return {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "projection": list(shot.projection),
        "matrixWorld": list(shot.matrix_world),
        "floorZ": shot.floor_z,
    }


def _project(client: TestClient, token: str, tmp_path: Path) -> tuple[str, Path]:
    source = tmp_path / "note.txt"
    source.write_text("hand", encoding="utf-8")
    created = client.post(
        "/api/projects",
        json={"linkPath": str(source), "name": "Scan"},
        headers=_headers(token),
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    folder = Path(created.json()["folder"])
    saved = client.put(
        f"/api/projects/{project_id}/plan",
        json=_wall_plan(),
        headers={**_headers(token), "If-Match": "0"},
    )
    assert saved.status_code == 200
    return project_id, folder


def _wall_plan() -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "units": "m",
        "revision": 0,
        "project": {"name": "Scan", "address": "", "northAngleDeg": 0},
        "sheet": {
            "paper": "A3",
            "orientation": "landscape",
            "scale": 50,
            "titleBlock": {
                "company": "",
                "project": "",
                "address": "",
                "drawnBy": "",
                "date": "",
                "sheetTitle": "",
                "sheetNumber": "",
                "revisionNote": "",
            },
        },
        "detection": {"source": None, "issues": []},
        "levels": [
            {
                "id": "L1",
                "name": "Ground",
                "elevation": 0,
                "ceilingHeight": 2.7,
                "vertices": [
                    {"id": "v1", "x": 0, "y": 0},
                    {"id": "v2", "x": 5, "y": 0},
                ],
                "walls": [
                    {
                        "id": "w1",
                        "a": "v1",
                        "b": "v2",
                        "thickness": 0.2,
                        "kind": "exterior",
                        "confidence": 1,
                    }
                ],
                "openings": [],
                "columns": [],
                "stairs": [],
                "rooms": [],
                "separators": [],
                "fixtures": [],
                "texts": [],
                "dimensions": [],
                "suppressedAutoDimensions": [],
            }
        ],
    }
