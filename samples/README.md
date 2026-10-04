# Samples

Real files live here. They are not committed. Tests skip a sample when the file is missing. A file that is present and fails its metric is a real failure.

## `samples/user/`

Your scans. Phase 1 moves `two_social_rooms_in_a_ruined_building.glb` here if it is still under `apps/api/data/`.

Put new files in this folder and add an entry to `samples/user/manifest.json` (copy `samples/manifest.example.json`). Until you have tape measurements, leave `references` empty. The import test will only check that the file opens.

When you measure a wall, add a reference:

```json
{
  "name": "south external wall",
  "lengthM": 8.42,
  "toleranceM": 0.05
}
```

Phase 16 compares that length with the plan. Default tolerance is 0.05 m if you omit `toleranceM`.

Do not commit this folder. It is git-ignored.

## `samples/public/`

Downloaded files. Also git-ignored. `scripts/fetch-samples.ps1` (Phase 7) downloads this list and does nothing if the file is already there. The default test run does not download.

| File | URL | Licence note |
| --- | --- | --- |
| `public/Duplex_A_20110907.ifc` | https://github.com/buildingSMART/Sample-Test-Files/blob/master/IFC%202x3/Duplex%20Apartment/Duplex_A_20110907.ifc | CC BY 4.0. Attribute as: BSI (2020) "Duplex Apartment Test Files," buildingSMART International, plus that GitHub URL. |

The fetch script must request the raw file, not the GitHub HTML page. If the URL answers 404, stop and report it. Do not invent a replacement URL.

Raw URL to try:

`https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Duplex%20Apartment/Duplex_A_20110907.ifc`

## What a manifest entry means

See `manifest.example.json`. `kind` is `mesh`, `cloud`, or `ifc`. `levels` is the number of storeys you expect, or `null` if you do not know yet. Tests must not invent a storey count when the field is null.
