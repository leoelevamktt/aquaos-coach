param(
  [string]$OutputDirectory = "backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
)

$resolvedRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedOutput = Join-Path $resolvedRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

docker compose exec -T postgres pg_dump -U natacao -d natacao | Out-File -Encoding utf8 (Join-Path $resolvedOutput "database.sql")
$storagePath = Join-Path $resolvedRoot "apps\api\storage"
if (Test-Path -LiteralPath $storagePath) {
  Compress-Archive -LiteralPath $storagePath -DestinationPath (Join-Path $resolvedOutput "storage.zip") -Force
}
Write-Host "Backup completo salvo em $resolvedOutput"
