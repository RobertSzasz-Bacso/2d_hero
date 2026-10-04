$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$UvDir = Join-Path $env:USERPROFILE ".local\bin"
if (Test-Path (Join-Path $UvDir "uv.exe")) {
  $env:Path = "$UvDir;$env:Path"
}

Push-Location (Join-Path $Root "apps\api")
try {
  uv run ruff check .
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  uv run pyright
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  uv run pytest
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $Root "apps\web")
try {
  npx tsc --noEmit -p tsconfig.app.json
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npx tsc --noEmit -p tsconfig.node.json
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npm test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
