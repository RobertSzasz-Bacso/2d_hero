import { useState } from "react";
import { generatePlan, uploadProject } from "./api";
import { Editor } from "./Editor";
import { useWorkspace } from "./store";

export function App() {
  const projectId = useWorkspace((state) => state.projectId);
  const error = useWorkspace((state) => state.error);
  const busy = useWorkspace((state) => state.busy);
  const openProject = useWorkspace((state) => state.openProject);
  const setError = useWorkspace((state) => state.setError);
  const setBusy = useWorkspace((state) => state.setBusy);
  const [dragOver, setDragOver] = useState(false);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await uploadProject(file);
      const plan = await generatePlan(created.id, 1.2);
      openProject(created.id, created.filename, plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that file.");
    } finally {
      setBusy(false);
    }
  }

  if (projectId) return <Editor />;

  return (
    <main
      className={dragOver ? "upload drag" : "upload"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void takeFile(event.dataTransfer.files[0]);
      }}
    >
      <p className="eyebrow">2D Hero</p>
      <h1>Turn a scan into a floor plan</h1>
      <p className="lede">
        Drop an iPhone mesh (glTF, GLB, OBJ, or USDZ), a laser scan (E57, LAS, or PLY), or an IFC model. You will get a draft you can correct, label, and export as PDF.
      </p>
      <label className="file">
        Choose a file
        <input
          data-testid="file-input"
          type="file"
          accept=".obj,.glb,.gltf,.ifc,.usdz,.e57,.las,.laz,.ply"
          onChange={(event) => void takeFile(event.target.files?.[0])}
        />
      </label>
      {busy ? <p>Reading the model…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
