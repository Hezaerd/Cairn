. (Join-Path $PSScriptRoot 'native-host-common.ps1')
Assert-OwnedRegistration
if (Test-Path -LiteralPath $ManifestPath) {
    $existing = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($existing.name -ne $HostName) { throw 'Manifest is not owned by Cairn. Nothing changed.' }
}
foreach ($view in $RegistryViews) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try { $base.DeleteSubKey($RegistryPath, $false) } finally { $base.Dispose() }
}
if (Test-Path -LiteralPath $ManifestPath) { Remove-Item -LiteralPath $ManifestPath }
Write-Output 'Cairn native host registration removed.'
