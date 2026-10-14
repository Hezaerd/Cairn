$ErrorActionPreference = 'Stop'
# Dev builds connect to their own host. The installer registers com.hezaerd.cairn.
$HostName = 'com.hezaerd.cairn.dev'
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ManifestPath = Join-Path $RepoRoot '.local\native-host.json'
# Chromium's Windows lookup checks this key, then Google\Chrome. Helium
# retains that lookup. Both views are checked to avoid shadowing an installation.
$RegistryPath = "Software\Chromium\NativeMessagingHosts\$HostName"
$RegistryViews = @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)

function Assert-OwnedRegistration {
    foreach ($view in $RegistryViews) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.OpenSubKey($RegistryPath)
            if ($null -ne $key) {
                try {
                    if ($key.GetValue('') -ne $ManifestPath -or $key.SubKeyCount -ne 0) {
                        throw "Another Cairn registration exists in $view. Nothing changed."
                    }
                } finally { $key.Dispose() }
            }
        } finally { $base.Dispose() }
    }
}
