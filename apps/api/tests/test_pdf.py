"""PDF export. Written before the renderer."""

from hero.pdf_export import render_pdf
from hero.schema import Annotation, Dimension, Opening, Plan, Room, Vertex, Wall


def test_pdf_includes_the_annotation_text():
    plan = Plan(
        vertices=[Vertex(id="v1", x=0, y=0), Vertex(id="v2", x=4, y=0)],
        walls=[Wall(id="w1", a="v1", b="v2")],
        annotations=[Annotation(id="a1", x=1, y=1, text="Kitchen")],
    )
    document = render_pdf(plan, title="Floor plan")
    assert document.startswith(b"%PDF")
    assert b"Kitchen" in document
    assert b"Floor plan" in document


def test_pdf_shows_openings_dimensions_and_room_area():
    plan = Plan(
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
        openings=[
            Opening(id="o1", wall="w1", kind="door", offset=0.5, width=0.9),
            Opening(id="o2", wall="w2", kind="window", offset=0.4, width=1.2),
        ],
        dimensions=[Dimension(id="d1", a="v1", b="v2", offset=0.5)],
        rooms=[Room(id="r1", name="Kitchen", vertices=["v1", "v2", "v3", "v4"])],
    )
    document = render_pdf(plan)
    assert b"Kitchen" in document
    assert b"12.0 m2" in document
    assert b"4.00 m" in document
    assert b" c" in document or b"c\n" in document
