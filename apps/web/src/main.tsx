import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import HostedGate from "./integrations/trimble/HostedGate.tsx";
import TrimblePicker from "./integrations/trimble/TrimblePicker.tsx";
import { createTrimbleAdapter, isEmbedded } from "./integrations/trimble/connection.ts";
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

// The Trimble file picker exists only in the hosted shell. Local mode renders App as before.
const adapter = hosted ? createTrimbleAdapter() : null;

createRoot(root).render(
  <StrictMode>
    {adapter ? (
      <HostedGate adapter={adapter}>
        <App
          hostedImport={(onProject) => <TrimblePicker adapter={adapter} onProject={onProject} />}
        />
      </HostedGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
