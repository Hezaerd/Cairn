param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId,
    [string] $BinaryPath
)
. (Join-Path $PSScriptRoot 'native-host-common.ps1')
if ([string]::IsNullOrEmpty($BinaryPath)) { $BinaryPath = Join-Path $RepoRoot 'target\debug\cairn-native-host.exe' }
$BinaryPath = (Resolve-Path -LiteralPath $BinaryPath -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($BinaryPath) -ne '.exe') { throw 'Expected a native host executable.' }
Assert-OwnedRegistration
$origins = @("chrome-extension://$ExtensionId/")
if (Test-Path -LiteralPath $ManifestPath) {
    $existing = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($existing.name -ne $HostName -or $existing.path -ne $BinaryPath) {
        throw 'Existing manifest belongs to another installation. Nothing changed.'
    }
    # Keep previously registered profiles/extensions when adding an origin.
    $origins = @($existing.allowed_origins) + $origins | Select-Object -Unique
    foreach ($origin in $origins) {
        if ($origin -notmatch '^chrome-extension://[a-p]{32}/$') { throw 'Invalid existing origin.' }
    }
}
New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) -Force | Out-Null
$manifest = @{ name = $HostName; description = 'Cairn local status bridge'; path = $BinaryPath; type = 'stdio'; allowed_origins = @($origins) }
[IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
foreach ($view in $RegistryViews) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        $key = $base.CreateSubKey($RegistryPath)
        try { $key.SetValue('', $ManifestPath, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Dispose() }
    } finally { $base.Dispose() }
}
Write-Output "Registered $HostName for $ExtensionId. Reload the extension in Helium."
