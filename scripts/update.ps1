$root = Split-Path $PSScriptRoot -Parent

git -C $root -c "safe.directory=$($root -replace '\\','/')" pull --ff-only
if ($LASTEXITCODE -ne 0) {
	Write-Error "git pull failed with exit code $LASTEXITCODE"
	exit $LASTEXITCODE
}

Write-Host "Update completed. Repository is up to date."
