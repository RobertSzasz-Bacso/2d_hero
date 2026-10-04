"""Doors, windows, dimensions, and room area. Written before the graph edits."""

import pytest

from hero.geometry import generate_plan
from hero.rooms import detect_rooms
from hero.schema import Annotation, Dimension, Opening, Plan, Room, Vertex, Wall

FIXTURES_BOX = __import__("pathlib").Path(__file__).resolve().parents[3] / "fixtures" / "box.obj"


def _rectangle() -> Plan:
    return Plan(
        vertices=[
            Vertex(id="v1", x=0, y=0),
            Vertex(id="v2", x=4, y=0),
            Vertex(id="v3", x=4, y=3),
            Vertex(id="v4", x=0, y=3),
        ],
        walls=[
            Wall(id="w1", a="v1", b="v2"),
            Wall(id="w2", a="v2", b="v3"),
            Wall(id="w3", a="v3", b="v4"),
            Wall(id="w4", a="v4", b="v1"),
        ],
    )


def test_phase1_plan_without_new_fields_still_loads():
    plan = Plan.model_validate(
        {
            "units": "m",
            "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 1, "y": 0}],
            "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
            "annotations": [{"id": "a1", "x": 0.2, "y": 0.2, "text": "Hall"}],
        }
    )
    assert plan.annotations[0].text == "Hall"
    assert plan.openings == []
    assert plan.dimensions == []
    assert plan.rooms == []


def test_openings_must_sit_on_a_real_wall():
    with pytest.raises(ValueError):
        Plan(
            vertices=[Vertex(id="v1", x=0, y=0), Vertex(id="v2", x=1, y=0)],
            walls=[Wall(id="w1", a="v1", b="v2")],
            openings=[Opening(id="o1", wall="missing", kind="door", offset=0.5, width=0.9)],
        )


def test_closed_rectangle_reports_its_area():
    rooms = detect_rooms(_rectangle())
    assert len(rooms) == 1
    assert rooms[0]["area"] == pytest.approx(12)
    drafted = generate_plan(FIXTURES_BOX, slice_height=1.2, gap_tolerance=0.05)
    drafted_rooms = detect_rooms(drafted)
    assert len(drafted_rooms) == 1
    assert drafted_rooms[0]["area"] == pytest.approx(12, abs=0.2)


def test_shared_wall_yields_two_rooms_and_drops_the_outside():
    plan = Plan(
        vertices=[
            Vertex(id="v1", x=0, y=0),
            Vertex(id="v2", x=2, y=0),
            Vertex(id="v3", x=4, y=0),
            Vertex(id="v4", x=4, y=3),
            Vertex(id="v5", x=2, y=3),
            Vertex(id="v6", x=0, y=3),
        ],
        walls=[
            Wall(id="w1", a="v1", b="v2"),
            Wall(id="w2", a="v2", b="v3"),
            Wall(id="w3", a="v3", b="v4"),
            Wall(id="w4", a="v4", b="v5"),
            Wall(id="w5", a="v5", b="v6"),
            Wall(id="w6", a="v6", b="v1"),
            Wall(id="w7", a="v2", b="v5"),
        ],
    )
    areas = sorted(room["area"] for room in detect_rooms(plan))
    assert areas == pytest.approx([6, 6])


def test_hosted_opening_and_dimension_round_trip():
    plan = _rectangle()
    plan.openings.append(Opening(id="o1", wall="w1", kind="door", offset=0.25, width=0.9))
    plan.openings.append(Opening(id="o2", wall="w2", kind="window", offset=0.5, width=1.2))
    plan.dimensions.append(Dimension(id="d1", a="v1", b="v2", offset=0.4))
    plan.rooms.append(Room(id="r1", name="Kitchen", vertices=["v1", "v2", "v3", "v4"]))
    restored = Plan.model_validate_json(plan.model_dump_json())
    assert restored.openings[0].kind == "door"
    assert restored.openings[1].kind == "window"
    assert restored.dimensions[0].a == "v1"
    assert restored.rooms[0].name == "Kitchen"
    assert restored.annotations == []
