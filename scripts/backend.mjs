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
  const candidates = isWindows ? ["py", "python"] : ["python3.11", "python3", "python"];
  for (const candidate of candidates) {
    const check = spawnSync(
      candidate,
      ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"],
      { stdio: "ignore" },
    );
    if (check.status === 0) return candidate;
  }
  console.error("Python 3.11+ não encontrado no PATH. Instale Python 3.11 e tente novamente.");
  process.exit(1);
}

const subcommand = process.argv[2];

function requireVenv() {
  if (!existsSync(venvPython)) {
    console.error("venv não encontrado. Rode `npm run setup:backend` primeiro.");
    process.exit(1);
  }
}

if (subcommand === "setup") {
  const python = resolveSystemPython();
  if (!existsSync(venvPython)) {
    run(python, ["-m", "venv", ".venv"]);
  }
  run(venvPython, ["-m", "pip", "install", "--require-hashes", "-r", "requirements-dev.txt"]);
} else if (subcommand === "dev") {
  requireVenv();
  run(venvPython, ["run.py"]);
} else if (subcommand === "test") {
  requireVenv();
  run(venvPython, ["-m", "pytest"]);
} else {
  console.error(`Uso: node scripts/backend.mjs <setup|dev|test>`);
  process.exit(1);
}
