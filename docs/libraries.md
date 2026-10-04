# Libraries

Use these. Do not add another package unless the current phase cannot be finished without it, and then record the reason in `docs/decisions.md` in the same commit.

Verify the import and the function signature in the installed version before writing a call. Wheels below are the Windows ones we expect for CPython 3.12. If a wheel will not install, stop and paste the error. Do not replace it with something from the deny list.

## Python (main app)

| Package | Import | Use |
| --- | --- | --- |
| `fastapi`, `uvicorn`, `python-multipart` | `fastapi` | HTTP. |
| `pydantic` v2 | `pydantic` | Schema. |
| `numpy`, `scipy` | `numpy`, `scipy` | Arrays, SVD, histograms. |
| `shapely` v2 | `shapely` | Polygons, polygonize, buffers, IoU. |
| `networkx` | `networkx` | Cell graph and min-cut. |
| `trimesh` | `trimesh` | OBJ, GLB, PLY meshes, decimation, sections. |
| `open3d` | `open3d` | Normals, optional plane patches. Fallback is in `docs/algorithms.md`. |
| `usd-core` | `pxr` | USDZ, including iPhone crate files. |
| `pye57` | `pye57` | E57, including scan poses. |
| `laspy`, `lazrs` | `laspy` | LAS and LAZ, chunked. |
| `ifcopenshell` | `ifcopenshell` | IFC. |
| `opencv-python-headless` | `cv2` | Elevation images and morphology. |
| `scikit-image` | `skimage` | Only if OpenCV is a worse fit for a documented step. Prefer `cv2`. |
| `pillow` | `PIL` | PNG underlays. |
| `keyring` | `keyring` | Windows Credential Manager. |
| `platformdirs` | `platformdirs` | Documents and `%APPDATA%` paths. Use the functions named in `docs/architecture.md`, not `user_data_dir`. |
| `sse-starlette` | `sse_starlette` | Job events. |
| `mcp` | `mcp` | Phase 15 tools. |
| `cursor-sdk` | `cursor_sdk` | Phase 15 only. Optional extra, not required for tests. |
| `pytest`, `httpx` | | Tests. |

Pin versions in `pyproject.toml` once Phase 1 has installed a working set. Do not leave ranges that float across a phase boundary without a lockfile (`uv.lock` is committed).

`cursor-sdk` stays an optional extra (`ai`). The default test environment does not need it.

## Python deny list

Do not import these:

| Name | Why |
| --- | --- |
| PDAL | Painful Windows build. LAS goes through `laspy`. |
| pymeshlab / MeshLab | Unreliable wheels. |
| cairo, `cairosvg`, GTK | Native DLL on Windows. PDF is `pdf-lib` in the browser. |
| CGAL and Python bindings | Same reason. |
| `ezdxf`, ODA, FreeCAD | No DXF or DWG in this product. |
| OpenCascade / `cadquery` | Huge, not needed. |
| `torch`, `tensorflow` | Phase 20 sidecar only, never the main env. |
| `reportlab`, `weasyprint` | No server-side PDF. |

## TypeScript

| Package | Use |
| --- | --- |
| `react`, `react-dom`, `vite`, `typescript` | App shell. |
| `tailwindcss`, shadcn/ui | UI. Initialize with the CLI. Do not invent a second component kit. |
| `three`, `@react-three/fiber`, `@react-three/drei` | 3D panel only. |
| `immer` | Undo patches. |
| `rbush` | Picking index. |
| `polygon-clipping` | Wall union and room faces. |
| `pdf-lib` | Vector PDF. |
| `zustand` | Editor UI state, not the plan kernel's history. |
| `vitest`, `@playwright/test`, `@testing-library/react` | Tests. |

The plan kernel must not depend on `react` or `three`. The editor plan view is plain SVG in React, drawn from `src/drawing/scene.ts`. It needs no canvas library.

## TypeScript deny list

`dxf-writer`, CAD web viewers, `jspdf` (use `pdf-lib`), any package that shells out to a native PDF engine, any UI kit other than shadcn/ui.
