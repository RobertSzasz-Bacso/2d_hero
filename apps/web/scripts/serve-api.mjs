import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api");
const candidates = [
  path.join(apiDir, ".venv", "Scripts", "python.exe"),
  path.join(apiDir, ".venv", "bin", "python"),
];
const python = candidates.find((candidate) => existsSync(candidate)) ?? "python";
const child = spawn(python, ["-m", "uvicorn", "hero.main:app", "--host", "127.0.0.1", "--port", "8000"], {
  cwd: apiDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
