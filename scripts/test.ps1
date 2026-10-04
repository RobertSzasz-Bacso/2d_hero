$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

if (Get-Command uv -ErrorAction SilentlyContinue) {
  Push-Location apps/api
  uv sync --extra dev
  uv run pytest
  Pop-Location
} else {
  python -m pip install -e "apps/api[dev]"
  python -m pytest apps/api/tests
}

Set-Location (Join-Path $Root "apps/web")
npm ci
npm test
npx playwright install chromium
npm run e2e
