import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import HostedGate from "./integrations/trimble/HostedGate.tsx";
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

createRoot(root).render(
  <StrictMode>
    {hosted ? (
      <HostedGate adapter={createTrimbleAdapter()}>
        <App />
      </HostedGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
