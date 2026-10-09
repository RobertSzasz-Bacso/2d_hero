$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $Root "apps\api"
$webDir = Join-Path $Root "apps\web"
$venvPython = Join-Path $apiDir ".venv\Scripts\python.exe"
$uv = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue
if (Test-Path $venvPython) {
  $apiCommand = $venvPython
  $apiArguments = @("-m", "hero", "--no-browser")
} elseif ($uv) {
  $apiCommand = $uv.Source
  $apiArguments = @("run", "hero", "--no-browser")
} else {
  throw "Could not find apps\api\.venv\Scripts\python.exe or uv.exe. Create the API environment or install uv."
}

$api = Start-Process -FilePath $apiCommand -ArgumentList $apiArguments -WorkingDirectory $apiDir -PassThru -NoNewWindow
if (-not $api) {
  throw "Could not start the API."
}

$ready = $false
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if ($api.HasExited) {
    throw "The API exited before it was ready."
  }
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 300
  }
}

if (-not $ready) {
  if (-not $api.HasExited) {
    Stop-Process -Id $api.Id -Force
  }
  throw "The API did not become ready on http://127.0.0.1:8000."
}

try {
  Set-Location $webDir
  npm run dev
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  if (-not $api.HasExited) {
    Stop-Process -Id $api.Id -Force
  }
}
