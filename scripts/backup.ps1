$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root "backups\$timestamp"

New-Item -ItemType Directory -Path $destination -Force | Out-Null

Copy-Item -Path (Join-Path $root "config/config.yaml") -Destination $destination -Force
Copy-Item -Path (Join-Path $root "db/sync.db") -Destination $destination -Force

Compress-Archive -Path "$destination\*" -DestinationPath "$destination.zip" -Force
Remove-Item -Path $destination -Recurse -Force

Write-Host "Backup completed. Files saved to: $destination"

Get-ChildItem -Path (Join-Path $root "backups") -File | Where-Object {$_.CreationTime -lt (Get-Date).AddDays(-30)} | Remove-Item -Force