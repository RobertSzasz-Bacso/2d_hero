# Run 2D Hero for Trimble Connect from your own PC through a Microsoft Dev Tunnel.
# A Dev Tunnel connects out over HTTPS (port 443), so it works where Cloudflare's port 7844 is blocked.
# No admin rights are needed. The tunnel is persistent, so the public URL is the same on every run.
#
# One-time setup:
#   1. winget install Microsoft.devtunnel      (or download it from Microsoft; no admin needed for a zip)
#   2. Create %APPDATA%\2D Hero\hosted.env with these lines (values come from the Trimble registration):
#        HERO_TRIMBLE_ISSUER=https://...
#        HERO_TRIMBLE_AUDIENCE=...
#        HERO_TRIMBLE_JWKS_URL=https://...
#        HERO_TRIMBLE_DOWNLOAD_HOSTS=host1,host2        (optional until you import from Trimble)
#   3. cd apps\web ; npm install ; npm run build
#   4. cd apps\api ; uv sync
# Then run:  powershell -File scripts\hosted-devtunnel.ps1
param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ConfigDir = Join-Path $env:APPDATA "2D Hero"
$SettingsFile = Join-Path $ConfigDir "hosted.env"

function Fail([string]$Message) {
  Write-Host $Message -ForegroundColor Red
  exit 1
}

$devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
if (-not $devtunnel) {
  Fail "devtunnel is not installed. Run: winget install Microsoft.devtunnel   then open a new terminal."
}

if (-not (Test-Path $SettingsFile)) {
  Fail "Missing $SettingsFile. See the header of scripts\hosted-devtunnel.ps1 for the lines it needs."
}
$settings = @{}
foreach ($line in Get-Content $SettingsFile) {
  $text = $line.Trim()
  if ($text -eq "" -or $text.StartsWith("#") -or -not $text.Contains("=")) { continue }
  $name, $value = $text.Split("=", 2)
  $settings[$name.Trim()] = $value.Trim()
}
foreach ($required in "HERO_TRIMBLE_ISSUER", "HERO_TRIMBLE_AUDIENCE", "HERO_TRIMBLE_JWKS_URL") {
  if (-not $settings[$required]) { Fail "$SettingsFile has no value for $required." }
}

if (-not (Test-Path (Join-Path $Root "apps\web\dist\index.html"))) {
  Fail "The web build is missing. Run: cd apps\web ; npm install ; npm run build"
}
$python = Join-Path $Root "apps\api\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  Fail "The API is not installed. Run: cd apps\api ; uv sync"
}

# Sign in once. The sign-in is a Microsoft or GitHub account, shown as a code to enter in a browser.
& devtunnel user show *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Sign in to Dev Tunnels (a Microsoft or GitHub account)."
  & devtunnel user login -d
  if ($LASTEXITCODE -ne 0) { Fail "Dev Tunnels sign-in failed." }
}

# One persistent tunnel per person. The name is remembered, so the URL stays the same.
$idFile = Join-Path $ConfigDir "devtunnel.id"
if (Test-Path $idFile) {
  $tunnel = (Get-Content $idFile -Raw).Trim()
} else {
  $user = ($env:USERNAME.ToLower() -replace "[^a-z0-9]", "")
  $tunnel = "hero-$user"
  New-Item -ItemType Directory -Force $ConfigDir | Out-Null
  & devtunnel create $tunnel --allow-anonymous
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the tunnel '$tunnel'. If the name is taken, put another name in $idFile and run again." }
  & devtunnel port create $tunnel -p $Port --protocol http
  if ($LASTEXITCODE -ne 0) { Fail "Could not add port $Port to the tunnel." }
  Set-Content -Path $idFile -Value $tunnel -Encoding ASCII
}

$log = Join-Path $env:TEMP "hero-devtunnel.out"
$err = Join-Path $env:TEMP "hero-devtunnel.err"
Remove-Item $log, $err -ErrorAction SilentlyContinue
$host_proc = Start-Process -FilePath $devtunnel.Source -ArgumentList @("host", $tunnel) `
  -RedirectStandardOutput $log -RedirectStandardError $err -NoNewWindow -PassThru

try {
  $publicUrl = $null
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not $publicUrl) {
    if ($host_proc.HasExited) { Fail "devtunnel stopped. See $log and $err." }
    if (Test-Path $log) {
      $match = [regex]::Match((Get-Content $log -Raw), "https://[a-z0-9.-]+-$Port\.[a-z0-9.-]*devtunnels\.ms")
      if ($match.Success) { $publicUrl = $match.Value }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $publicUrl) { Fail "The tunnel did not report a public address in 60 s. See $log." }

  $publicHost = ([uri]$publicUrl).Host
  $env:HERO_HOSTED_PUBLIC_URL = $publicUrl
  $env:HERO_HOSTED_ALLOWED_HOSTS = $publicHost
  foreach ($key in $settings.Keys) { Set-Item -Path "Env:$key" -Value $settings[$key] }

  Write-Host ""
  Write-Host "Manifest URL for Trimble Connect (Project Settings > Extensions):" -ForegroundColor Green
  Write-Host "  $publicUrl/trimble/manifest.json"
  Write-Host "Open $publicUrl once in a browser and choose Continue, then reload Trimble Connect."
  Write-Host "Press Ctrl+C to stop."
  Write-Host ""

  & $python -m hero --hosted --host 127.0.0.1 --port $Port
} finally {
  if ($host_proc -and -not $host_proc.HasExited) {
    Stop-Process -Id $host_proc.Id -Force
  }
}
