import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import HostedGate from "./integrations/trimble/HostedGate.tsx";
import TrimblePicker from "./integrations/trimble/TrimblePicker.tsx";
import TrimbleSavePanel from "./integrations/trimble/TrimbleSavePanel.tsx";
import { createTrimbleAdapter, isEmbedded } from "./integrations/trimble/connection.ts";
import { PdfSaveTargetContext, type PdfSaveTarget } from "./pdf/target.ts";
import { takeSessionToken } from "./session.ts";
import "./index.css";

// Local mode keeps the loopback session token. Hosted mode is an iframe with no session token:
// the Trimble Connect parent supplies the access token, and it stays in memory.
const localToken = takeSessionToken();
const hosted = localToken === null && isEmbedded();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing.");
}

// The Trimble file picker and "Save to Trimble Connect" exist only in the hosted shell.
// Local mode renders App as before, with no save target.
const adapter = hosted ? createTrimbleAdapter() : null;
const saveTarget: PdfSaveTarget | null = adapter
  ? {
      label: "Save to Trimble Connect",
      render: (request) => <TrimbleSavePanel adapter={adapter} request={request} />,
    }
  : null;

createRoot(root).render(
  <StrictMode>
    {adapter ? (
      <HostedGate adapter={adapter}>
        <PdfSaveTargetContext.Provider value={saveTarget}>
          <App
            hostedImport={(onProject) => <TrimblePicker adapter={adapter} onProject={onProject} />}
          />
        </PdfSaveTargetContext.Provider>
      </HostedGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
