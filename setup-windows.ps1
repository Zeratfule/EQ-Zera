# EQ Zera — one-time Windows toolchain setup.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
# Installs Node 24, Git, rustup, and the MSVC C++ build tools via winget, then the project deps.

$ErrorActionPreference = 'Stop'

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have winget)) {
  Write-Host "winget not found. Install 'App Installer' from the Microsoft Store, then re-run." -ForegroundColor Red
  exit 1
}

if (-not (Have node)) {
  Write-Host "Installing Node.js 24..." -ForegroundColor Cyan
  winget install --id OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
} else { Write-Host "Node present: $(node -v)" }

if (-not (Have git)) {
  Write-Host "Installing Git..." -ForegroundColor Cyan
  winget install --id Git.Git --accept-source-agreements --accept-package-agreements
} else { Write-Host "Git present: $(git --version)" }

if (-not (Have cargo) -and -not (Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe")) {
  Write-Host "Installing Rust (rustup)..." -ForegroundColor Cyan
  winget install --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
} else { Write-Host "Rust present" }

# MSVC linker for Rust. Skips if cl.exe / link.exe already resolvable via a VS install.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVc = (Test-Path $vswhere) -and ((& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) -ne $null)
if (-not $hasVc) {
  Write-Host "Installing Visual Studio Build Tools (C++ workload) - this is large and takes a while..." -ForegroundColor Cyan
  winget install --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements `
    --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
} else { Write-Host "MSVC C++ build tools present" }

Write-Host ""
Write-Host "Toolchain done. CLOSE this window, open a NEW PowerShell in this folder, then run:" -ForegroundColor Green
Write-Host "  npm ci"
Write-Host "  npm run deps:electron"
Write-Host "  npm run build:engine"
Write-Host "  npm run dev"
