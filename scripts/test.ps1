param(
  [switch]$Api,
  [switch]$Web
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$UvDir = Join-Path $env:USERPROFILE ".local\bin"
if (Test-Path (Join-Path $UvDir "uv.exe")) {
  $env:Path = "$UvDir;$env:Path"
}

$runApi = -not $Web -or $Api
$runWeb = -not $Api -or $Web

if ($runApi) {
  Push-Location (Join-Path $Root "apps\api")
  try {
    uv run pytest
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
}

if ($runWeb) {
  Push-Location (Join-Path $Root "apps\web")
  try {
    npm test
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
}
