# Game Changer App Template - Windows Interactive Installer
#
# Usage (run in PowerShell / Windows Terminal):
#   $f="$env:TEMP\gc-install.ps1"; irm "https://raw.githubusercontent.com/RanNahmany/game-changer-app-template/main/scripts/install-windows.ps1" -OutFile $f; & $f; Remove-Item $f -ErrorAction SilentlyContinue

$REPO_URL = "https://github.com/RanNahmany/game-changer-app-template.git"

# -- Execution Policy Fix -----------------------------------------------------
# npm on Windows is a .ps1 script -- if the execution policy is Restricted or
# AllSigned, running npm will fail with "cannot be loaded because running scripts
# is disabled on this system". Fix it for the current user (no admin needed).
$effectivePolicy = Get-ExecutionPolicy
if ($effectivePolicy -in @('Restricted', 'AllSigned', 'Undefined')) {
    Write-Host "  [!]  PowerShell script execution is currently blocked ($effectivePolicy)." -ForegroundColor Yellow
    Write-Host "  --> Fixing: setting execution policy to RemoteSigned for current user..." -ForegroundColor Yellow
    try {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Write-Host "  [OK] Execution policy set to RemoteSigned (CurrentUser)" -ForegroundColor Green
    } catch {
        Write-Host "  [!]  Could not set execution policy: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "       Run this manually and try again:" -ForegroundColor Red
        Write-Host "       Set-ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor White
        exit 1
    }
}

# -- Helpers ------------------------------------------------------------------
function Write-Step { param([string]$msg)
    Write-Host ""
    Write-Host "----------------------------------------------" -ForegroundColor Cyan
    Write-Host " $msg" -ForegroundColor Cyan
    Write-Host "----------------------------------------------" -ForegroundColor Cyan
}
function Write-Ok  { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info { param([string]$msg) Write-Host "  --> $msg" -ForegroundColor Yellow }
function Write-Err { param([string]$msg) Write-Host "  [!]  $msg" -ForegroundColor Red }
function Write-Dim { param([string]$msg) Write-Host "  $msg" -ForegroundColor DarkGray }

# -- Header -------------------------------------------------------------------
Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "   Game Changer -- App Template Setup          " -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

# -- Step 1: Project name -----------------------------------------------------
Write-Step "Step 1 - Project name"
Write-Host ""
Write-Dim "Give your project a name (lowercase, letters/numbers/hyphens)."
Write-Dim "This becomes the folder name and the name in package.json."
Write-Host ""

$projectName = ""
do {
    $rawName = Read-Host "  Project name"
    $projectName = (($rawName.ToLower() -replace '[^a-z0-9-]', '-') -replace '-+', '-') -replace '^-|-$', ''
    if (-not $projectName) {
        Write-Err "Name cannot be empty -- try again."
    }
} while (-not $projectName)

Write-Ok "Project name: $projectName"

# -- Step 2: Choose install location ------------------------------------------
Write-Step "Step 2 - Choose install location"
Write-Host ""

# Use the Shell API to get the real Desktop path (works for all locales/languages)
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
    $desktopPath = "$env:USERPROFILE\Desktop"
}

$option1 = "$desktopPath\projects\$projectName"
$option2 = "C:\projects\$projectName"

Write-Dim "Where should the project be installed?"
Write-Host ""
Write-Host "  [1] $option1  " -NoNewline -ForegroundColor White
Write-Host "(default -- recommended)" -ForegroundColor DarkGray
Write-Host "  [2] $option2" -ForegroundColor White
Write-Host "  [3] Custom path -- I'll type it myself" -ForegroundColor White
Write-Host ""

$targetDir = ""
do {
    $choice = Read-Host "  Enter your choice (1 / 2 / 3) [1]"
    if (-not $choice) { $choice = "1" }
    switch ($choice.Trim()) {
        "1" {
            $targetDir = $option1
        }
        "2" {
            $targetDir = $option2
        }
        "3" {
            Write-Host ""
            Write-Dim "Enter the parent folder where the project will be created."
            Write-Dim "Example: D:\dev   or   C:\Users\$env:USERNAME\code"
            Write-Dim "The template will be created inside this folder, as a subfolder named `"$projectName`"."
            Write-Host ""
            $customBase = Read-Host "  Parent folder path"
            if (-not $customBase) {
                Write-Err "Path cannot be empty -- try again."
                $targetDir = ""
            } else {
                $targetDir = Join-Path $customBase.Trim() $projectName
            }
        }
        default {
            Write-Err "Please enter 1, 2, or 3."
            $targetDir = ""
        }
    }
} while (-not $targetDir)

Write-Ok "Target folder: $targetDir"

# -- Step 3: Clone ------------------------------------------------------------
Write-Step "Step 3 - Cloning template"

if (Test-Path $targetDir) {
    Write-Err "Folder already exists: $targetDir"
    Write-Host "  Delete it first, or pick a different project name." -ForegroundColor Red
    exit 1
}

$parentDir = Split-Path $targetDir -Parent
New-Item -ItemType Directory -Force -Path $parentDir | Out-Null

git clone $REPO_URL $targetDir
if ($LASTEXITCODE -ne 0) {
    Write-Err "git clone failed. Make sure git is installed and you have internet access."
    exit 1
}
Write-Ok "Template cloned"

# -- Step 4: Setup ------------------------------------------------------------
Write-Step "Step 4 - Running project setup"

Set-Location $targetDir
npm run setup
if ($LASTEXITCODE -ne 0) {
    Write-Err "Setup failed. Check the error above."
    exit 1
}

# -- Done ---------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  All done! Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Open " -NoNewline -ForegroundColor White
Write-Host "Visual Studio Code" -ForegroundColor White
Write-Host ""
Write-Host "  2. " -NoNewline -ForegroundColor White
Write-Host "File > Open Folder" -NoNewline -ForegroundColor White
Write-Host "  (or " -NoNewline -ForegroundColor White
Write-Host "Ctrl+O" -NoNewline -ForegroundColor Yellow
Write-Host ")  --  pick this folder:" -ForegroundColor White
Write-Host "     $targetDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "  3. Open " -NoNewline -ForegroundColor White
Write-Host "Claude Code" -NoNewline -ForegroundColor White
Write-Host " via its VS Code extension" -ForegroundColor White
Write-Host "     (the Claude icon in the VS Code side bar)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  4. In the Claude Code chat, type:" -ForegroundColor White
Write-Host "     /start-from-template" -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
