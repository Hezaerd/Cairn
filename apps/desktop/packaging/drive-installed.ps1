param(
    [Parameter(Mandatory)][string]$Executable,
    [switch]$CreateVault,
    [switch]$Relaunched,
    [string]$UpdateVersion,
    [switch]$RejectUpdate
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run the installed vault test on a disposable GitHub-hosted runner'
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class FixtureInput {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int x, int y, uint data, IntPtr extra);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, IntPtr extra);

    public static void Click(int x, int y) {
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("Could not move the fixture pointer");
        mouse_event(2, 0, 0, 0, IntPtr.Zero);
        mouse_event(4, 0, 0, 0, IntPtr.Zero);
    }

    public static void EnterPassword() {
        foreach (char character in "synthetic installer fixture password") {
            byte key = (byte)char.ToUpperInvariant(character);
            keybd_event(key, 0, 0, IntPtr.Zero);
            keybd_event(key, 0, 2, IntPtr.Zero);
            Thread.Sleep(15);
        }
    }
}
'@
if ($CreateVault) {
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
    [FixtureInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
    Click-Control $field
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (!$field.Current.HasKeyboardFocus -or [FixtureInput]::GetForegroundWindow() -ne $app.MainWindowHandle) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Could not focus '$Name'" }
        Start-Sleep -Milliseconds 50
    }
    [FixtureInput]::EnterPassword()
}

function Click-Control($Control) {
    $bounds = $Control.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $Control.Current.IsOffscreen) {
        throw "Control '$($Control.Current.Name)' is offscreen"
    }
    [FixtureInput]::Click([int]($bounds.Left + $bounds.Width / 2), [int]($bounds.Top + $bounds.Height / 2))
}

function Press([string]$Name, [Windows.Automation.ControlType]$Type = $null) {
    $control = Find-Control $Name $Type
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (!$control.Current.IsEnabled) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "'$Name' stayed disabled" }
        Start-Sleep -Milliseconds 50
    }
    Click-Control $control
}

try {
    Enter-Password 'Master password'
    if ($CreateVault) {
        Enter-Password 'Confirm password'
        Press 'Create vault' ([Windows.Automation.ControlType]::Button)
        Find-Control 'No logins' | Out-Null
        Press 'Settings'
        Press 'Start with Windows' ([Windows.Automation.ControlType]::CheckBox)
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        while ((Get-ItemProperty $runKey -Name Cairn -ErrorAction SilentlyContinue).Cairn -ne "`"$Executable`" --autostart") {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Cairn did not register startup' }
            Start-Sleep -Milliseconds 100
        }
        'The published nightly created a synthetic vault and registered startup'
    } else {
        Press 'Unlock' ([Windows.Automation.ControlType]::Button)
        Find-Control 'No logins' | Out-Null
        'The installed build opened the synthetic vault'
        if ($UpdateVersion -or $Relaunched) {
            $button = [Windows.Automation.ControlType]::Button
            Press 'Settings' $button
            Press 'Updates' $button
            $check = Find-Control 'Check for updates' $button
            if (!$check.Current.IsEnabled) { throw 'Update checks are disabled' }
        }
        if ($UpdateVersion) {
            Press 'Check for updates' $button
            Find-Control "Cairn $UpdateVersion is available" | Out-Null
            Press 'Install' $button
            if ($RejectUpdate) {
                Find-Control 'The update failed.' | Out-Null
                'Settings rejected the tampered installer'
            } else {
                if (!$app.WaitForExit(120000)) { throw 'Cairn did not exit after installing the update' }
                'Settings launched the verified installer and quit'
            }
        }
    }
} finally {
    if (!$app.HasExited) {
        Stop-Process -Id $app.Id
        $app.WaitForExit()
    }
}
