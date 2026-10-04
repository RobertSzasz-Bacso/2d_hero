#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/bin:${PATH}"

if command -v uv >/dev/null 2>&1; then
  (cd apps/api && uv sync --extra dev && uv run pytest)
else
  python3 -m pip install -e "apps/api[dev]"
  python3 -m pytest apps/api/tests
fi

cd apps/web
npm ci
npm test
npx playwright install chromium
npm run e2e
