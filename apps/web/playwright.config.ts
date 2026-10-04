import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5191",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "powershell -File ../../scripts/e2e-server.ps1",
    url: "http://127.0.0.1:5191",
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
