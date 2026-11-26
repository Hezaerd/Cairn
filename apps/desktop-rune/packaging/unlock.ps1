param(
    [Parameter(Mandatory)][string]$Executable,
    [switch]$Relaunched
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run the installed vault test on a disposable GitHub-hosted runner'
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
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

function Find-Control([string]$Name) {
    $condition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::NameProperty, $Name)
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
    throw "Cairn did not show '$Name'"
}

try {
    $field = Find-Control 'Master password'
    if (!$field.Current.IsPassword) { throw 'Master password edit is not secure' }
    $shell = New-Object -ComObject WScript.Shell
    if (!$shell.AppActivate($app.Id)) { throw 'Could not activate Cairn' }
    $field.SetFocus()
    $shell.SendKeys('synthetic installer fixture password')
    $button = Find-Control 'Unlock'
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Find-Control 'No logins' | Out-Null
    'Installed Rune opened the synthetic Tauri vault'
} finally {
    if (!$app.HasExited) {
        Stop-Process -Id $app.Id
        $app.WaitForExit()
    }
}
