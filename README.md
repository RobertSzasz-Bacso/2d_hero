# 2D Hero

A local Windows app that turns a 3D scan or an IFC model into an editable metric floor plan and a scaled PDF.

The app is a local API plus a settings page. Projects are folders under `Documents\2D Hero`. Settings, except the Cursor key, live in `%APPDATA%\2D Hero`. The Cursor key is stored with Windows Credential Manager and is never written into a project or a response. Later phases add the editor and the PDF.

## Start the app

Install [uv](https://docs.astral.sh/uv/) and Node.js, then:

```powershell
powershell -File scripts\dev.ps1
```

Open http://127.0.0.1:5173. From `apps/api`, `uv run hero` serves a production build of `apps/web/dist` and opens the browser.

## Where the work is

- [master_plan.md](master_plan.md) — the phases. Each one has a prompt to paste into a new Cursor chat.
- [AGENTS.md](AGENTS.md) — how an agent must work in this repo.
- [docs/](docs/) — the schema, the algorithms, the drawing rules, and the libraries. These override the prototype and `docs/research/`.

Start with the first phase in `master_plan.md` whose status is `not started`. One phase per chat.

## Your scan files

Put real scans in `samples/user/` and describe them in a `manifest.json` copied from [samples/manifest.example.json](samples/manifest.example.json). That folder is not committed. See [samples/README.md](samples/README.md).

`samples/user/two_social_rooms_in_a_ruined_building.glb` is the owner's scan. It is not committed.

## Run a phase

1. Open a new chat in this repo.
2. Copy that phase's prompt from `master_plan.md`.
3. Paste it as the first message.

The phase ends with tests, a handoff note in `docs/handoff/`, and a commit on `main`. Nothing is pushed unless you ask.
