"""Render TypeScript types from the plan JSON Schema."""

import json
from typing import Any


def render_plan_types(schema: dict[str, Any]) -> str:
    """Turn the exported plan JSON Schema into a TypeScript module."""
    lines = [
        "/**",
        " * Plan document types generated from the hero JSON Schema.",
        " * Do not edit. A test fails if a fresh generate would change this file.",
        " */",
        "",
    ]
    defs = schema.get("$defs", {})
    lines.extend(_emit_type(str(schema["title"]), schema))
    lines.append("")
    for name in sorted(defs):
        lines.extend(_emit_type(name, defs[name]))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _emit_type(name: str, schema: dict[str, Any]) -> list[str]:
    if schema.get("type") == "object" or "properties" in schema:
        return _emit_interface(name, schema)
    return [f"export type {name} = {_ts_type(schema)};"]


def _emit_interface(name: str, schema: dict[str, Any]) -> list[str]:
    lines = [f"export interface {name} {{"]
    for key, prop in schema.get("properties", {}).items():
        lines.append(f"  {key}: {_ts_type(prop)};")
    lines.append("}")
    return lines


def _ts_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if "const" in schema:
        return _literal(schema["const"])
    if "enum" in schema:
        return " | ".join(_literal(item) for item in schema["enum"])
    if "oneOf" in schema:
        return _union(schema["oneOf"])
    if "anyOf" in schema:
        return _union(schema["anyOf"])
    type_name = schema.get("type")
    if type_name == "string":
        return "string"
    if type_name in ("integer", "number"):
        return "number"
    if type_name == "boolean":
        return "boolean"
    if type_name == "null":
        return "null"
    if type_name == "array":
        item = _ts_type(schema["items"])
        if "|" in item:
            return f"({item})[]"
        return f"{item}[]"
    raise ValueError(f"Unsupported JSON Schema node: {schema!r}")


def _union(options: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for option in options:
        part = _ts_type(option)
        if part not in parts:
            parts.append(part)
    return " | ".join(parts)


def _literal(value: object) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    raise ValueError(f"Unsupported literal: {value!r}")
