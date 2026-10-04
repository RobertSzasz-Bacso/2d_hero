"""The generated TypeScript plan types must match a fresh schema export."""


def test_generated_plan_types_match_schema_export() -> None:
    from hero.paths import repo_root
    from hero.schema import render_plan_types_ts

    path = repo_root() / "apps" / "web" / "src" / "core" / "plan-types.ts"
    generated = render_plan_types_ts()
    on_disk = path.read_text(encoding="utf-8")
    assert on_disk == generated
