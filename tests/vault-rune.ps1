param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$Directory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CairnWindow {
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, [MarshalAs(UnmanagedType.LPWStr)] string cls, IntPtr name);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder name, int capacity, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMenuItemRect(IntPtr window, IntPtr menu, uint item, out Rect bounds);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, IntPtr extra);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    public static void TypeFixture(string text) {
        foreach (char character in text) {
            if (character != ' ' && (character < 'a' || character > 'z')) {
                throw new ArgumentException("Use lowercase ASCII letters and spaces in fixture passwords.");
            }
            byte key = (byte)char.ToUpperInvariant(character);
            keybd_event(key, 0, 0, IntPtr.Zero);
            keybd_event(key, 0, 2, IntPtr.Zero);
        }
    }

    public static IntPtr FindClass(IntPtr parent, string cls, int processId) {
        var window = IntPtr.Zero;
        do {
            window = FindWindowExW(parent, window, cls, IntPtr.Zero);
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            if (pid == processId) return window;
        } while (window != IntPtr.Zero);
        return IntPtr.Zero;
    }

    public static bool OpenTrayMenu(int processId) {
        // RuneTray receives the notification area's right-button-up callback.
        var tray = FindClass(new IntPtr(-3), "RuneTray", processId);
        return tray != IntPtr.Zero && PostMessageW(tray, 0x8001, new IntPtr(1), new IntPtr(0x205));
    }

    public static bool ClickTrayItem(int processId, string label) {
        var popup = FindClass(IntPtr.Zero, "#32768", processId);
        if (popup == IntPtr.Zero || !IsWindowVisible(popup)) return false;
        var menu = SendMessageW(popup, 0x01E1, IntPtr.Zero, IntPtr.Zero);
        var name = new StringBuilder(256);
        for (uint i = 0; i < GetMenuItemCount(menu); i++) {
            GetMenuStringW(menu, i, name, name.Capacity, 0x400);
            if (name.ToString() != label) continue;
            Rect bounds;
            if (!GetMenuItemRect(popup, menu, i, out bounds)) return false;
            SetCursorPos((bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2);
            mouse_event(2, 0, 0, 0, IntPtr.Zero);
            mouse_event(4, 0, 0, 0, IntPtr.Zero);
            return true;
        }
        return false;
    }
}
'@

$labels = Get-Content -Raw -Encoding UTF8 "$PSScriptRoot/../apps/desktop-rune/src/i18n/messages/fr-FR.json" | ConvertFrom-Json
$env:CAIRN_TEST_LOCALE = 'fr-FR'
$env:CAIRN_TEST_DATA_DIR = Join-Path $Directory 'data'
$vault = Join-Path $env:CAIRN_TEST_DATA_DIR 'vault.cairn'
$master = 'synthetic master password'
$wrong = 'incorrect fixture password'
$scope = [Windows.Automation.TreeScope]::Descendants

function Wait-For([string]$Description, [scriptblock]$Probe) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 30) {
        try {
            $result = & $Probe
            if ($result) { return $result }
        } catch [Windows.Automation.ElementNotAvailableException] {
        }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for $Description"
}

function Start-Cairn([string[]]$Arguments = @()) {
    $start = [Diagnostics.ProcessStartInfo]::new($Executable, ($Arguments -join ' '))
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    [Diagnostics.Process]::Start($start)
}

function Main-Window($App) {
    $App.Refresh()
    if ($App.HasExited) { throw "Cairn exited with $($App.ExitCode)" }
    $window = $App.MainWindowHandle
    if ($App.MainWindowTitle -eq $labels.'app.name' -and [CairnWindow]::IsWindowVisible($window)) {
        return $window
    }
    [IntPtr]::Zero
}

function Find-Name($Root, [string]$Name, $Type = $null) {
    $nameCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($Type) {
        $typeCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
        return $Root.FindFirst($scope, [Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@($nameCondition, $typeCondition)))
    }
    $Root.FindFirst($scope, $nameCondition)
}

function Find-Control([string]$Name, $Type = $null) {
    Wait-For $Name {
        $window = Main-Window $app
        if ($window -ne [IntPtr]::Zero) {
            Find-Name ([Windows.Automation.AutomationElement]::FromHandle($window)) $Name $Type
        }
    }
}

function Click($Element) {
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $Element.Current.IsOffscreen) { throw "Control is offscreen" }
    if (![CairnWindow]::SetCursorPos([int]($bounds.Left + $bounds.Width / 2), [int]($bounds.Top + $bounds.Height / 2))) {
        throw "Could not position the test pointer"
    }
    [CairnWindow]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero)
    [CairnWindow]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
}

function Press([string]$Name) {
    $button = Find-Control $Name ([Windows.Automation.ControlType]::Button)
    Wait-For "$Name to become enabled" { $button.Current.IsEnabled } | Out-Null
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Enter-Password([string]$Name, [string]$Password) {
    $field = Find-Control $Name ([Windows.Automation.ControlType]::Edit)
    if (!$field.Current.IsPassword) { throw "UI Automation does not identify $Name as a password" }
    $window = Main-Window $app
    [CairnWindow]::SetForegroundWindow($window) | Out-Null
    if (!$field.Current.HasKeyboardFocus) { Click $field }
    Wait-For "$Name keyboard focus" { $field.Current.HasKeyboardFocus -and [CairnWindow]::GetForegroundWindow() -eq $window } | Out-Null
    [CairnWindow]::TypeFixture($Password)
}

function Unlock([string]$Password) {
    Enter-Password $labels.'auth.masterPassword' $Password
    Press $labels.'auth.unlock'
}

function Find-InWindow([string]$Name) {
    $window = Main-Window $app
    if ($window -ne [IntPtr]::Zero) {
        Find-Name ([Windows.Automation.AutomationElement]::FromHandle($window)) $Name
    }
}

function Enter-Text([string]$Name, [string]$Text) {
    $field = Find-Control $Name ([Windows.Automation.ControlType]::Edit)
    Click $field
    Wait-For "$Name keyboard focus" { $field.Current.HasKeyboardFocus } | Out-Null
    [CairnWindow]::TypeFixture($Text)
}

function Assert-SecretHidden {
    if ((Find-InWindow $loginPassword) -or (Find-InWindow $loginNotes)) {
        throw 'The login password or notes were exposed before reveal'
    }
}

function Assert-HiddenWindow([string]$Name) {
    Wait-For "$Name to close" { !(Find-InWindow $Name) } | Out-Null
}
function Wait-Locked {
    Find-Control $labels.'auth.lockedTitle' | Out-Null
    Find-Control $labels.'auth.masterPassword' ([Windows.Automation.ControlType]::Edit) | Out-Null
}

function Wait-Unlocked {
    Find-Control $labels.'credentials.empty' | Out-Null
}

function Close-ToTray {
    $window = Main-Window $app
    if ($window -eq [IntPtr]::Zero -or !$app.CloseMainWindow()) { throw 'No Cairn window to close' }
    Wait-For 'Cairn to hide' { ![CairnWindow]::IsWindowVisible($window) } | Out-Null
    if ($app.HasExited) { throw 'Closing ended the process' }
}

function Tray-Click([string]$Name) {
    Wait-For 'Rune tray notification window' { [CairnWindow]::OpenTrayMenu($app.Id) } | Out-Null
    Wait-For "tray menu item $Name" { [CairnWindow]::ClickTrayItem($app.Id, $Name) } | Out-Null
}

function Wait-Exit($Process) {
    if (!$Process.WaitForExit(15000)) { throw "Process $($Process.Id) did not exit" }
    if ($Process.ExitCode -ne 0) { throw "Process $($Process.Id) exited with $($Process.ExitCode)" }
}

$cursor = [Windows.Forms.Cursor]::Position
$app = $null
$duplicate = $null
try {
    $app = Start-Cairn
    Find-Control $labels.'auth.createTitle' | Out-Null
    Enter-Password $labels.'auth.masterPassword' $master
    Enter-Password $labels.'auth.confirmation' $wrong
    Press $labels.'auth.create'
    Find-Control $labels.'auth.mismatch' | Out-Null
    if (Test-Path $vault) { throw 'Mismatched passwords created a vault' }

    Enter-Password $labels.'auth.masterPassword' $master
    Enter-Password $labels.'auth.confirmation' $master
    Press $labels.'auth.create'
    Wait-Unlocked
    $ciphertext = [IO.File]::ReadAllText($vault)
    $envelope = $ciphertext | ConvertFrom-Json
    if ($ciphertext.Contains($master) -or $envelope.wrapped_key.Count -ne 48 -or $envelope.ciphertext.Count -le 16) {
        throw 'The vault on disk is not an encrypted envelope'
    }
    'Create, confirmation, UI Automation password fields, and encryption passed'

    Press $labels.'toolbar.lock'
    Wait-Locked
    Unlock $wrong
    Find-Control $labels.'errors.UnlockFailed' | Out-Null
    Unlock $master
    Wait-Unlocked
    'Lock and wrong-password retry passed'

    Tray-Click $labels.'tray.lock'
    Wait-Locked
    Unlock $master
    Wait-Unlocked
    Close-ToTray
    $duplicate = Start-Cairn
    Wait-Exit $duplicate
    Wait-Locked
    'Tray Lock, close-to-tray, and second launch passed'

    Close-ToTray
    Tray-Click $labels.'tray.open'
    Wait-Locked
    Tray-Click $labels.'tray.quit'
    Wait-Exit $app
    'Tray Open and Quit passed'

    $app = Start-Cairn -Arguments @('--autostart')
    Wait-For 'autostart tray' { [CairnWindow]::FindClass([IntPtr](-3), 'RuneTray', $app.Id) -ne [IntPtr]::Zero } | Out-Null
    if ((Main-Window $app) -ne [IntPtr]::Zero) { throw 'Autostart showed a window' }
    Tray-Click $labels.'tray.open'
    Wait-Locked
    Unlock $master
    Wait-Unlocked
    Tray-Click $labels.'tray.quit'
    Wait-Exit $app
    if ([IO.File]::ReadAllText($vault) -cne $ciphertext) { throw 'Unlocking rewrote the vault' }
    'Restart and locked autostart passed'

    $app = Start-Cairn
    Wait-Locked
    Unlock $master
    Wait-Unlocked

    $loginPassword = 'synthetic login password'
    $loginNotes = 'synthetic private notes'
    Press $labels.'add.open'
    Enter-Text $labels.'entry.name' 'atlas fixture'
    Enter-Password $labels.'entry.password' $loginPassword
    Enter-Text $labels.'entry.notes' $loginNotes
    Press $labels.'common.save'
    Assert-HiddenWindow $labels.'add.title'
    Find-Control 'atlas fixture' | Out-Null
    Assert-SecretHidden
    Press $labels.'credentials.showPassword'
    Find-Control $loginPassword | Out-Null
    Find-Control $loginNotes | Out-Null
    Press $labels.'credentials.hidePassword'
    Wait-For 'password hidden' { !(Find-InWindow $loginPassword) } | Out-Null
    Assert-SecretHidden

    Press $labels.'credentials.copyPassword'
    Wait-For 'password copied to clipboard' { [Windows.Forms.Clipboard]::GetText() -ceq $loginPassword } | Out-Null
    Assert-SecretHidden
    Press $labels.'edit.open'
    Find-Control $labels.'entry.notesUnchanged' | Out-Null
    Enter-Text $labels.'entry.name' ' updated'
    Press $labels.'common.save'
    Assert-HiddenWindow $labels.'edit.title'
    Find-Control 'atlas fixture updated' | Out-Null
    Press $labels.'credentials.showPassword'
    Find-Control $loginPassword | Out-Null
    Find-Control $loginNotes | Out-Null
    Press $labels.'edit.open'
    Find-Control $labels.'entry.notes' ([Windows.Automation.ControlType]::Edit) | Out-Null
    $changedPassword = 'synthetic changed password'
    Enter-Password $labels.'entry.password' $changedPassword
    Press $labels.'common.save'
    Assert-HiddenWindow $labels.'edit.title'
    Assert-SecretHidden
    Press $labels.'credentials.showPassword'
    Find-Control $changedPassword | Out-Null
    Find-Control $loginNotes | Out-Null
    'Saved login, hidden and revealed details, copy, and both edit paths passed'

    Press $labels.'add.open'
    Enter-Text $labels.'entry.name' 'generator fixture'
    Press $labels.'generator.open'
    Find-Control $labels.'generator.title' | Out-Null
    $slider = Find-Control $labels.'generator.length' ([Windows.Automation.ControlType]::Slider)
    $range = $slider.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern)
    if ($range.Current.Value -ne 20) { throw 'Unexpected default generator length' }
    $range.SetValue(32)
    $symbols = Find-Control $labels.'generator.symbols' ([Windows.Automation.ControlType]::CheckBox)
    $symbols.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle()
    $ambiguous = Find-Control $labels.'generator.avoidAmbiguous' ([Windows.Automation.ControlType]::CheckBox)
    $ambiguous.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle()
    Press $labels.'generator.regenerate'
    Press $labels.'generator.use'
    Assert-HiddenWindow $labels.'generator.title'
    Press $labels.'common.save'
    Assert-HiddenWindow $labels.'add.title'
    Enter-Text $labels.'credentials.search' 'generator'
    Press $labels.'credentials.showPassword'
    $generated = Wait-For '32 generated characters in revealed details' {
        $window = [Windows.Automation.AutomationElement]::FromHandle((Main-Window $app))
        $nodes = $window.FindAll($scope, [Windows.Automation.Condition]::TrueCondition)
        foreach ($node in $nodes) {
            if ($node.Current.Name -cmatch '^[a-kmnp-zA-HJ-NP-Z2-9]{32}$') { return $node.Current.Name }
        }
    }
    if ($generated -cnotmatch '[a-z]' -or $generated -cnotmatch '[A-Z]' -or $generated -notmatch '[0-9]') {
        throw 'Generated password lacked an enabled character group'
    }
    $preferences = Join-Path $env:CAIRN_TEST_DATA_DIR 'password-generator.json'
    if ([IO.File]::ReadAllText($preferences).Contains($generated)) { throw 'Generated password persisted in settings' }
    Press $labels.'remove.open'
    Press $labels.'common.cancel'
    Find-Control 'generator fixture' | Out-Null
    Press $labels.'remove.open'
    Press $labels.'remove.confirm'
    Find-Control $labels.'credentials.notFound' | Out-Null
    'Generator options, using a generated password, and delete confirmation passed'

    $search = Find-Control $labels.'credentials.search' ([Windows.Automation.ControlType]::Edit)
    Click $search
    Wait-For 'search keyboard focus' { $search.Current.HasKeyboardFocus } | Out-Null
    [Windows.Forms.SendKeys]::SendWait('^{a}{BACKSPACE}')
    Find-Control 'atlas fixture updated' | Out-Null
    Press $labels.'credentials.copyPassword'
    Wait-For 'updated password on the clipboard' { [Windows.Forms.Clipboard]::GetText() -ceq $changedPassword } | Out-Null
    Press $labels.'toolbar.lock'
    Wait-Locked
    Wait-For 'lock to clear the copied password' { [Windows.Forms.Clipboard]::GetText() -cne $changedPassword } | Out-Null
    Tray-Click $labels.'tray.quit'
    Wait-Exit $app
    $app = Start-Cairn
    Wait-Locked
    Unlock $master
    Find-Control 'atlas fixture updated' | Out-Null
    Assert-SecretHidden
    Press $labels.'add.open'
    Press $labels.'generator.open'
    $slider = Find-Control $labels.'generator.length' ([Windows.Automation.ControlType]::Slider)
    $range = $slider.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern)
    if ($range.Current.Value -ne 32) { throw 'Generator length did not persist after restart' }
    $symbols = Find-Control $labels.'generator.symbols' ([Windows.Automation.ControlType]::CheckBox)
    if ($symbols.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -ne 'Off') {
        throw 'Generator character groups did not persist after restart'
    }
    [Windows.Forms.SendKeys]::SendWait('{ESC}')
    Assert-HiddenWindow $labels.'generator.title'
    Find-Control $labels.'add.title' | Out-Null
    [Windows.Forms.SendKeys]::SendWait('{ESC}')
    Assert-HiddenWindow $labels.'add.title'
    Tray-Click $labels.'tray.quit'
    Wait-Exit $app
    foreach ($file in @($vault, (Join-Path $env:CAIRN_TEST_DATA_DIR 'backups/previous.cairn'))) {
        $data = [IO.File]::ReadAllText($file)
        foreach ($value in @($loginPassword, $changedPassword, $loginNotes, $generated, 'atlas fixture')) {
            if ($data.Contains($value)) { throw 'Login data appeared in plaintext on disk' }
        }
    }
    'Lock cleared the clipboard and settings and entries survived restart'
    $scriptPath = Join-Path $Directory 'unlock.json'
    $tree = Join-Path $Directory 'unlocked-tree.json'
    @(
        @{ t = 0.05; type = 'tap'; key = 'master' }
        @{ t = 0.10; type = 'type'; text = $master }
        @{ t = 1.65; type = 'key'; name = 'Enter' }
    ) | ConvertTo-Json | Set-Content -Encoding ASCII -LiteralPath $scriptPath
    & $Executable --script $scriptPath --realtime --tree $tree --fps 12 --at 14.0 --settle
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $tree)) { throw 'Rune element tree capture failed' }
    $data = [IO.File]::ReadAllText($tree)
    if (!$data.Contains('atlas fixture updated')) { throw 'The tree did not capture the unlocked login' }
    if ($data.Contains($changedPassword) -or $data.Contains($loginNotes)) {
        throw 'Hidden login secrets appeared in the element tree'
    }
    'Unlocked element tree kept the saved password and notes hidden'

    $corrupt = 'damaged synthetic vault bytes'
    [IO.File]::WriteAllText($vault, $corrupt)
    $app = Start-Cairn
    Wait-Locked
    Unlock $master
    Find-Control $labels.'errors.InvalidVault' | Out-Null
    if ([IO.File]::ReadAllText($vault) -cne $corrupt) { throw 'Corrupt vault was replaced' }
    Tray-Click $labels.'tray.quit'
    Wait-Exit $app
    'Corrupt vault was reported and preserved'
} finally {
    foreach ($process in @($app, $duplicate)) {
        if ($process -and !$process.HasExited) {
            Stop-Process -Id $process.Id
            $process.WaitForExit()
        }
    }
    [Windows.Forms.Cursor]::Position = $cursor
}
