"""Round-trip the plan schema examples from docs/plan-schema.md."""

import copy
import json

import pytest
from pydantic import ValidationError

VALID_JSON = """
{
  "schemaVersion": 2,
  "units": "m",
  "revision": 0,
  "project": { "name": "Example", "address": "", "northAngleDeg": 0 },
  "sheet": {
    "paper": "A3",
    "orientation": "landscape",
    "scale": 50,
    "titleBlock": {
      "company": "",
      "project": "Example",
      "address": "",
      "drawnBy": "",
      "date": "",
      "sheetTitle": "Ground floor",
      "sheetNumber": "01",
      "revisionNote": ""
    }
  },
  "detection": { "source": null, "issues": [] },
  "levels": [
    {
      "id": "L1",
      "name": "Ground floor",
      "elevation": 0,
      "ceilingHeight": 2.7,
      "vertices": [
        { "id": "v1", "x": 0, "y": 0 },
        { "id": "v2", "x": 5, "y": 0 },
        { "id": "v3", "x": 5, "y": 4 },
        { "id": "v4", "x": 0, "y": 4 }
      ],
      "walls": [
        { "id": "w1", "a": "v1", "b": "v2", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w2", "a": "v2", "b": "v3", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w3", "a": "v3", "b": "v4", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w4", "a": "v4", "b": "v1", "thickness": 0.2, "kind": "exterior", "confidence": 1 }
      ],
      "openings": [
        {
          "id": "o1",
          "wall": "w1",
          "kind": "door",
          "offset": 0.5,
          "width": 0.9,
          "sill": 0,
          "head": 2.1,
          "swing": "left",
          "swingSide": "positive",
          "confidence": 1
        }
      ],
      "columns": [],
      "stairs": [],
      "rooms": [
        { "id": "r1", "name": "Room", "number": "01", "seed": { "x": 2.5, "y": 2 } }
      ],
      "separators": [],
      "fixtures": [],
      "texts": [],
      "dimensions": [],
      "suppressedAutoDimensions": []
    }
  ]
}
"""


def _valid() -> dict:
    return json.loads(VALID_JSON)


def test_valid_example_round_trips() -> None:
    from hero.schema import Plan

    raw = _valid()
    plan = Plan.model_validate(raw)
    assert plan.model_dump(mode="json") == raw
    again = Plan.model_validate_json(plan.model_dump_json())
    assert again.model_dump(mode="json") == raw


def test_blank_plan_uses_documented_defaults() -> None:
    from hero.schema import Plan

    plan = Plan.model_validate(
        {
            "schemaVersion": 2,
            "units": "m",
            "revision": 0,
            "project": {},
            "levels": [],
            "sheet": {},
            "detection": {},
        }
    )
    dumped = plan.model_dump(mode="json")
    assert dumped["project"] == {"name": "", "address": "", "northAngleDeg": 0}
    assert dumped["sheet"]["paper"] == "A3"
    assert dumped["sheet"]["orientation"] == "landscape"
    assert dumped["sheet"]["scale"] == 50
    assert dumped["sheet"]["titleBlock"]["company"] == ""
    assert dumped["detection"] == {"source": None, "issues": []}
    assert dumped["levels"] == []


def test_missing_vertex_is_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"][0]["walls"][0]["a"] = "v9"
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_schema_version_1_is_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["schemaVersion"] = 1
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_head_equal_to_sill_is_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    opening = payload["levels"][0]["openings"][0]
    opening["head"] = 1
    opening["sill"] = 1
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_duplicate_vertex_ids_are_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"][0]["vertices"].append({"id": "v1", "x": 1, "y": 1})
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_wall_with_the_same_endpoints_is_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"][0]["walls"][1]["b"] = payload["levels"][0]["walls"][1]["a"]
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_opening_wider_than_its_wall_is_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"][0]["openings"][0]["width"] = 5
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


@pytest.mark.parametrize(
    ("mutate",),
    [
        ("opening",),
        ("separator",),
        ("dimension",),
    ],
)
def test_missing_reference_is_rejected(mutate: str) -> None:
    from hero.schema import Plan

    payload = _valid()
    level = payload["levels"][0]
    if mutate == "opening":
        level["openings"][0]["wall"] = "w9"
    elif mutate == "separator":
        level["separators"].append({"id": "s1", "a": "v9", "b": "v1"})
    else:
        level["dimensions"].append(
            {
                "id": "d1",
                "auto": True,
                "offset": 0.4,
                "segments": [
                    {
                        "a": {"type": "vertex", "id": "v1"},
                        "b": {"type": "vertex", "id": "v9"},
                    }
                ],
            }
        )
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_number_is_rejected(bad: float) -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"][0]["vertices"][0]["x"] = bad
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


def test_duplicate_level_ids_are_rejected() -> None:
    from hero.schema import Plan

    payload = _valid()
    payload["levels"].append(copy.deepcopy(payload["levels"][0]))
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)
