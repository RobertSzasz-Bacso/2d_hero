import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sessionFile = process.env.HERO_SESSION_FILE
  ? path.resolve(process.env.HERO_SESSION_FILE)
  : path.resolve(rootDir, "../api/.session-token");
const apiPort = process.env.HERO_API_PORT ?? "8000";

function sessionToken(): string {
  try {
    return fs.readFileSync(sessionFile, "utf8").trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const token = sessionToken();
            if (token.length > 0) {
              proxyReq.setHeader("X-Hero-Token", token);
            }
          });
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
