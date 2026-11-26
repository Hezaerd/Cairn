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
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] private static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageText(IntPtr window, uint message, IntPtr wParam, string text);
    [DllImport("user32.dll")] private static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder name, int capacity, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMenuItemRect(IntPtr window, IntPtr menu, uint item, out Rect bounds);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, IntPtr extra);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    public static bool SetEditText(IntPtr window, string text) {
        return SendMessageText(window, 0x000C, IntPtr.Zero, text) != IntPtr.Zero;
    }

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
