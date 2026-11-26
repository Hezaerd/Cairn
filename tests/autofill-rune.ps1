param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][string]$Action,
    [string]$Target,
    [string]$Value
)

. (Join-Path $PSScriptRoot 'rune-window.ps1')
Add-Type -AssemblyName System.Drawing
$labels = Get-Content -Raw -Encoding UTF8 "$PSScriptRoot/../apps/desktop-rune/src/i18n/messages/fr-FR.json" | ConvertFrom-Json
$app = Get-Process -Id $ProcessId

function Focus-Cairn {
    $window = Wait-For 'Cairn window' { $handle = Main-Window $app; if ($handle -ne [IntPtr]::Zero) { $handle } }
    [CairnWindow]::SetForegroundWindow($window) | Out-Null
    Wait-For 'Cairn to come to the front' { [CairnWindow]::GetForegroundWindow() -eq $window } | Out-Null
    return $window
}

switch ($Action) {
    Press { Press $Target }
    Wait { Find-Control $Target | Out-Null }
    Rename {
        $button = Wait-For 'browser rename button' {
            $window = Main-Window $app
            if ($window -eq [IntPtr]::Zero) { return }
            $root = [Windows.Automation.AutomationElement]::FromHandle($window)
            $condition = [Windows.Automation.PropertyCondition]::new(
                [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
            $root.FindAll($scope, $condition) | Where-Object { $_.Current.Name -like 'Renommer *' } | Select-Object -First 1
        }
        $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    }
    Unlock { Unlock $Value }
    Text {
        Focus-Cairn | Out-Null
        $field = Find-Control $Target ([Windows.Automation.ControlType]::Edit)
        Click $field
        Wait-For 'rename field keyboard focus' { $field.Current.HasKeyboardFocus } | Out-Null
        [Windows.Forms.SendKeys]::SendWait('^a')
        [Windows.Forms.SendKeys]::SendWait($Value)
    }
    Key {
        Focus-Cairn | Out-Null
        [Windows.Forms.SendKeys]::SendWait($Value)
    }
    Screenshot {
        $window = Focus-Cairn
        $bounds = [Windows.Automation.AutomationElement]::FromHandle($window).Current.BoundingRectangle
        $bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            Start-Sleep -Milliseconds 150
            $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
            $bitmap.Save($Value, [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
    default { throw "Unknown Rune test action: $Action" }
}
