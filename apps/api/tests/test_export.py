"""DXF and SVG export. Written before the serializers."""

from hero.dxf_export import render_dxf
from hero.svg_export import render_svg
from hero.schema import Annotation, Dimension, Opening, Plan, Room, Vertex, Wall


def _plan() -> Plan:
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
        annotations=[Annotation(id="a1", x=1, y=1, text="Pantry")],
        openings=[
            Opening(id="o1", wall="w1", kind="door", offset=0.5, width=0.9),
            Opening(id="o2", wall="w2", kind="window", offset=0.4, width=1.2),
        ],
        dimensions=[Dimension(id="d1", a="v1", b="v2")],
        rooms=[Room(id="r1", name="Kitchen", vertices=["v1", "v2", "v3", "v4"])],
    )


def test_dxf_uses_separate_layers():
    text = render_dxf(_plan()).decode()
    for layer in ("WALLS", "DOORS", "WINDOWS", "ANNOTATIONS"):
        assert layer in text
    assert "LINE" in text
    assert "ARC" in text
    assert "Kitchen" in text
    assert "Pantry" in text
    assert "4.00 m" in text
    assert "12.0 m2" in text


def test_svg_groups_the_same_layers():
    text = render_svg(_plan()).decode()
    assert text.startswith("<svg")
    assert 'id="walls"' in text
    assert 'id="doors"' in text
    assert 'id="windows"' in text
    assert 'id="annotations"' in text
    assert "Kitchen" in text
    assert "Pantry" in text
    assert "4.00 m" in text


def test_phase1_plan_still_exports():
    plan = Plan(
        vertices=[Vertex(id="v1", x=0, y=0), Vertex(id="v2", x=2, y=0)],
        walls=[Wall(id="w1", a="v1", b="v2")],
    )
    assert b"WALLS" in render_dxf(plan)
    assert b'id="walls"' in render_svg(plan)
