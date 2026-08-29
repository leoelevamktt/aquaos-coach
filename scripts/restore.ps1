param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory
)

$resolvedRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBackup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$databaseFile = Join-Path $resolvedBackup "database.sql"
$storageFile = Join-Path $resolvedBackup "storage.zip"
$storageTarget = Join-Path $resolvedRoot "apps\api"

if (-not (Test-Path -LiteralPath $databaseFile)) { throw "database.sql não encontrado no backup." }
Get-Content -LiteralPath $databaseFile -Raw | docker compose exec -T postgres psql -U natacao -d natacao
if (Test-Path -LiteralPath $storageFile) {
  Expand-Archive -LiteralPath $storageFile -DestinationPath $storageTarget -Force
}
Write-Host "Banco e arquivos restaurados a partir de $resolvedBackup"
