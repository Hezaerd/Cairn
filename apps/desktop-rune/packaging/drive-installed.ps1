param(
    [Parameter(Mandatory)][string]$Executable,
    [switch]$CreateTauriVault,
    [switch]$Relaunched
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run the installed vault test on a disposable GitHub-hosted runner'
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if ($CreateTauriVault) {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path (Resolve-Path .local) 'tauri-webview'
}
if ($Relaunched) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $app = Get-Process cairn-desktop -ErrorAction SilentlyContinue | Where-Object Path -eq $Executable
        if ($app) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$app) { throw 'The updater did not relaunch Cairn' }
} else {
    $app = Start-Process -FilePath $Executable -PassThru
}

function Find-Control([string]$Name, [Windows.Automation.ControlType]$Type = $null) {
    $condition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($Type) {
        $typeCondition = [Windows.Automation.PropertyCondition]::new(
            [Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
        $condition = [Windows.Automation.AndCondition]::new(
            [Windows.Automation.Condition[]]@($condition, $typeCondition))
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        $app.Refresh()
        if ($app.HasExited) { throw "Cairn exited with $($app.ExitCode)" }
        if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
            $window = [Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
            $control = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
            if ($control) { return $control }
        }
        Start-Sleep -Milliseconds 100
    }
    if ($window) {
        $window.FindAll(
            [Windows.Automation.TreeScope]::Descendants,
            [Windows.Automation.Condition]::TrueCondition
        ) | Select-Object -First 35 | ForEach-Object {
            Write-Host "$($_.Current.ControlType.ProgrammaticName) '$($_.Current.Name)'"
        }
    }
    throw "Cairn did not show '$Name'"
}

function Enter-Password([string]$Name) {
    $field = Find-Control $Name ([Windows.Automation.ControlType]::Edit)
    if (!$field.Current.IsPassword) { throw 'Master password edit is not secure' }
    if (!$shell.AppActivate($app.Id)) { throw 'Could not activate Cairn' }
    $field.SetFocus()
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (!$field.Current.HasKeyboardFocus) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Could not focus '$Name'" }
        Start-Sleep -Milliseconds 50
    }
    $shell.SendKeys('synthetic installer fixture password')
}

function Press([string]$Name, [Windows.Automation.ControlType]$Type) {
    $control = Find-Control $Name $Type
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (!$control.Current.IsEnabled) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "'$Name' stayed disabled" }
        Start-Sleep -Milliseconds 50
    }
    $pattern = $null
    if ($control.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        $pattern.Toggle()
    } else {
        $control.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    }
}

try {
    $shell = New-Object -ComObject WScript.Shell
    Enter-Password 'Master password'
    if ($CreateTauriVault) {
        Enter-Password 'Confirm password'
        Press 'Create vault' ([Windows.Automation.ControlType]::Button)
        Find-Control 'No logins' | Out-Null
        Press 'Settings' ([Windows.Automation.ControlType]::Hyperlink)
        Press 'Start with Windows' ([Windows.Automation.ControlType]::CheckBox)
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        while ((Get-ItemProperty $runKey -Name Cairn -ErrorAction SilentlyContinue).Cairn -ne "`"$Executable`" --autostart") {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Tauri did not register startup' }
            Start-Sleep -Milliseconds 100
        }
        'The installed Tauri nightly created a synthetic vault and registered startup'
    } else {
        Press 'Unlock' ([Windows.Automation.ControlType]::Button)
        Find-Control 'No logins' | Out-Null
        'Installed Rune opened the synthetic Tauri vault'
    }
} finally {
    if (!$app.HasExited) {
        Stop-Process -Id $app.Id
        $app.WaitForExit()
    }
}
