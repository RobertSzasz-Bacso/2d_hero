# 2D Hero — technical presentation

A standalone walkthrough of the local scan-to-floor-plan architecture. It does not start the app and it does not read project files.

## Run

From the repository root:

```powershell
cd presentation
npm install
npm run dev
```

Open the URL Vite prints (port 5174 unless that port is taken).

## Present

- **Next:** `→` or `Space`, or the Next button.
- **Back:** `←` or Prev.
- **Jump:** the dots in the top bar.
- **Simulate flow:** plays a packet along the stage path. The payload inspector follows the node the packet reaches.
- **Click a node** to read a sample input, the transformation, and the output.
- **Current implementation** hides Phase 20. **Full target architecture** draws the planned ML sidecar as a dashed node. It is specified in `master_plan.md` and is not built.
