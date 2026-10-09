"""Color-mask furniture decoding."""

from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw
from shapely.geometry import box

from hero.ai.mask import MASK_PALETTE, MaskFrame, decode_mask
from hero.ai.room import RoomBounds


def _bounds() -> RoomBounds:
    return RoomBounds(
        polygon=box(0.0, 0.0, 3.0, 2.4),
        width=3.0,
        depth=2.4,
        area=7.2,
        min_x=0.0,
        min_y=0.0,
        max_x=3.0,
        max_y=2.4,
    )


def _mask(*, antialias: bool = False, inner_gap_px: int = 0) -> bytes:
    image = Image.new("RGB", (300, 240), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 299, 239), fill=MASK_PALETTE["floor"])
    toilet = MASK_PALETTE["toilet"]
    tub = MASK_PALETTE["bathtub"]
    draw.rectangle((inner_gap_px, 80, 50 + inner_gap_px, 140), fill=toilet)
    draw.rectangle((220 - inner_gap_px, 35, 278 - inner_gap_px, 95), fill=tub)
    if antialias:
        draw.rectangle(
            (21 + inner_gap_px, 79, 73 + inner_gap_px, 141),
            outline=(245, 245, 245),
            width=1,
        )
        draw.rectangle(
            (219 - inner_gap_px, 34, 279 - inner_gap_px, 96),
            outline=(245, 245, 245),
            width=1,
        )
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _frame() -> MaskFrame:
    return MaskFrame(
        origin=(0.0, 0.0),
        x_axis=(3.0, 0.0),
        y_axis=(0.0, 2.4),
    )


def test_mask_places_wall_adjacent_fixtures_and_measures_their_full_boxes() -> None:
    found = decode_mask(_mask(), _frame(), _bounds())

    toilet = next(item for item in found if item.symbol == "toilet")
    tub = next(item for item in found if item.symbol == "bathtub")
    assert toilet.x == pytest.approx(0.25, abs=0.04)
    assert toilet.y == pytest.approx(1.30, abs=0.04)
    assert toilet.width == pytest.approx(0.50, abs=0.04)
    assert toilet.depth == pytest.approx(0.60, abs=0.04)
    assert tub.x == pytest.approx(2.49, abs=0.04)
    assert tub.y == pytest.approx(1.75, abs=0.04)
    assert tub.width == pytest.approx(0.58, abs=0.04)
    assert tub.depth == pytest.approx(0.60, abs=0.04)


def test_mask_snaps_ten_centimetres_to_wall_but_not_fifty() -> None:
    near = decode_mask(_mask(inner_gap_px=10), _frame(), _bounds())
    far = decode_mask(_mask(inner_gap_px=50), _frame(), _bounds())

    near_toilet = next(item for item in near if item.symbol == "toilet")
    far_toilet = next(item for item in far if item.symbol == "toilet")
    near_right = near_toilet.x + near_toilet.width / 2.0
    far_right = far_toilet.x + far_toilet.width / 2.0
    assert near_toilet.x - near_toilet.width / 2.0 == pytest.approx(0.0, abs=0.01)
    assert far_toilet.x - far_toilet.width / 2.0 > 0.35
    assert near_right < far_right


def test_mask_accepts_antialiased_edges() -> None:
    found = decode_mask(_mask(antialias=True), _frame(), _bounds())
    assert {item.symbol for item in found} == {"toilet", "bathtub"}


def test_mask_without_floor_is_rejected() -> None:
    image = Image.new("RGB", (300, 240), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((22, 80, 72, 140), fill=MASK_PALETTE["toilet"])
    output = io.BytesIO()
    image.save(output, format="PNG")

    with pytest.raises(ValueError, match="floor"):
        decode_mask(output.getvalue(), _frame(), _bounds())


def test_cursor_svg_mask_is_rasterized_to_the_palette() -> None:
    from hero.ai.chat import _svg_mask_png

    png = _svg_mask_png(
        '<svg viewBox="0 0 100 80">'
        '<rect x="0" y="0" width="100" height="80" fill="#eeeeee"/>'
        '<rect x="2" y="20" width="20" height="20" fill="#dc3c3c"/>'
        "</svg>"
    )
    found = decode_mask(png, MaskFrame((0.0, 0.0), (3.0, 0.0), (0.0, 2.4)), _bounds())
    assert [item.symbol for item in found] == ["toilet"]
