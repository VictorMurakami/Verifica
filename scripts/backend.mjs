#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const isWindows = platform() === "win32";
const backendDir = join(process.cwd(), "backend");
const venvDir = join(backendDir, ".venv");
const venvPython = isWindows
  ? join(venvDir, "Scripts", "python.exe")
  : join(venvDir, "bin", "python");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    cwd: backendDir,
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveSystemPython() {
  for (const candidate of isWindows ? ["python", "py"] : ["python3", "python"]) {
    const check = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (check.status === 0) return candidate;
  }
  console.error("Python não encontrado no PATH. Instale Python 3.10+ e tente novamente.");
  process.exit(1);
}

const subcommand = process.argv[2];

if (subcommand === "setup") {
  const python = resolveSystemPython();
  if (!existsSync(venvPython)) {
    run(python, ["-m", "venv", ".venv"]);
  }
  run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"]);
} else if (subcommand === "dev") {
  if (!existsSync(venvPython)) {
    console.error("venv não encontrado. Rode `npm run setup:backend` primeiro.");
    process.exit(1);
  }
  run(venvPython, ["run.py"]);
} else {
  console.error(`Uso: node scripts/backend.mjs <setup|dev>`);
  process.exit(1);
}
