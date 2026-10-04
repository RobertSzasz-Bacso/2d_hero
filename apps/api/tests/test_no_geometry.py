import importlib

import pytest


def test_hero_geometry_module_is_absent() -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("hero.geometry")
