$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$UvDir = Join-Path $env:USERPROFILE ".local\bin"
if (Test-Path (Join-Path $UvDir "uv.exe")) {
  $env:Path = "$UvDir;$env:Path"
}

$uv = "uv"
$uvExe = Join-Path $UvDir "uv.exe"
if (Test-Path $uvExe) {
  $uv = $uvExe
}

$apiDir = Join-Path $Root "apps\api"
$webDir = Join-Path $Root "apps\web"
$tmp = Join-Path $webDir "e2e\.tmp"
if (Test-Path $tmp) {
  Remove-Item $tmp -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $tmp "projects") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tmp "config") | Out-Null

foreach ($port in 8091, 5191) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
  try {
    $listener.Start()
  } catch {
    throw "Port $port is already in use. Stop the other process before the browser tests."
  } finally {
    if ($listener.Server.IsBound) {
      $listener.Stop()
    }
  }
}

$sessionFile = Join-Path $tmp "session.token"
$api = Start-Process -FilePath $uv -ArgumentList @(
  "run", "hero", "--no-browser", "--port", "8091",
  "--projects-dir", (Join-Path $tmp "projects"),
  "--config-dir", (Join-Path $tmp "config"),
  "--session-file", $sessionFile
) -WorkingDirectory $apiDir -PassThru -NoNewWindow
if (-not $api) {
  throw "Could not start the API."
}

$ready = $false
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  if ($api.HasExited) {
    throw "The API exited before it was ready."
  }
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8091/api/health" -UseBasicParsing -TimeoutSec 2
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
  throw "The API did not become ready on http://127.0.0.1:8091."
}

try {
  Set-Location $webDir
  $env:HERO_API_PORT = "8091"
  $env:HERO_SESSION_FILE = $sessionFile
  npm run dev -- --host 127.0.0.1 --port 5191 --strictPort
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  if (-not $api.HasExited) {
    Stop-Process -Id $api.Id -Force
  }
}
