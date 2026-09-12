# Builds dist\MTGCardViewer.exe
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m pip install --upgrade pyinstaller
python -m pip install -r requirements.txt
python -m PyInstaller --noconfirm --clean MTGCardViewer.spec

Write-Host ""
Write-Host "Built: $(Join-Path $PSScriptRoot 'dist\MTGCardViewer.exe')"
