import importlib

import pytest

PHASE1_MODULES = [
    "trimesh",
    "open3d",
    "shapely",
    "cv2",
    "laspy",
    "pye57",
    "ifcopenshell",
    "keyring",
    "pxr",
]


@pytest.mark.parametrize("module_name", PHASE1_MODULES)
def test_phase1_library_imports(module_name: str) -> None:
    importlib.import_module(module_name)
