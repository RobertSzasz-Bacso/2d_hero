# Download the public samples listed in samples/README.md.
# Skips a file that is already present. The test run does not call this script.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DestDir = Join-Path $Root "samples\public"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

$Files = @(
  @{
    Name = "Duplex_A_20110907.ifc"
    Url = "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Duplex%20Apartment/Duplex_A_20110907.ifc"
  }
)

foreach ($item in $Files) {
  $dest = Join-Path $DestDir $item.Name
  if (Test-Path $dest) {
    Write-Output "present $($item.Name)"
    continue
  }
  Write-Output "download $($item.Name)"
  try {
    Invoke-WebRequest -Uri $item.Url -OutFile $dest -UseBasicParsing
  } catch {
    throw "Could not download $($item.Url). Stop. Do not invent a replacement URL. $($_.Exception.Message)"
  }
  if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 64) {
    throw "Download of $($item.Name) was empty."
  }
}
