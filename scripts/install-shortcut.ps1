param(
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $Root "apps\api"

if (-not $Destination) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $Destination = Join-Path $desktop "2D Hero.lnk"
} elseif (Test-Path -LiteralPath $Destination -PathType Container) {
  $Destination = Join-Path $Destination "2D Hero.lnk"
}

$uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
if (-not (Test-Path -LiteralPath $uv)) {
  $command = Get-Command uv -ErrorAction SilentlyContinue
  if ($command) {
    $uv = $command.Source
  }
}
if (-not (Test-Path -LiteralPath $uv)) {
  throw "uv was not found. Install uv from https://docs.astral.sh/uv/ and run this script again."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($Destination)
$shortcut.TargetPath = $uv
$shortcut.Arguments = "run hero"
$shortcut.WorkingDirectory = $apiDir
$shortcut.Description = "Start 2D Hero and open the browser"
$shortcut.Save()
Write-Output $Destination
