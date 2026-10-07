param(
    [string]$Chemin = "C:\Users\Yanis\Downloads\test-envoi.jpg",
    [switch]$Image
)

# Met un VRAI fichier dans le presse-papier Windows, met WhatsApp au premier plan,
# puis envoie un Ctrl+V natif (evenement de confiance, contrairement aux evenements
# synthetiques du DOM que WhatsApp ignore).
#
# GARDE-FOU : si WhatsApp n'est pas au premier plan, on n'envoie RIEN. Sinon le Ctrl+V
# partirait dans la fenetre active (terminal, editeur...), ce qui est imprevisible.

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Chemin)) { "ECHEC : fichier absent $Chemin"; exit 1 }
$abs = (Resolve-Path $Chemin).Path

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
'@
[void][K]::SetProcessDPIAware()

# 1) presse-papier : passer par Windows PowerShell 5.1, qui est en STA (obligatoire pour le presse-papier)
$mode = if ($Image) { 'image' } else { 'fichier' }
$ps51 = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = if ($Image) {
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
    "`$i=[System.Drawing.Image]::FromFile('$abs'); [System.Windows.Forms.Clipboard]::SetImage(`$i); 'ok'"
}
else {
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "`$c=New-Object System.Collections.Specialized.StringCollection; [void]`$c.Add('$abs'); " +
    "[System.Windows.Forms.Clipboard]::SetFileDropList(`$c); 'ok'"
}
$r = & $ps51 -STA -NoProfile -Command $script
if ($r -ne 'ok') { "ECHEC presse-papier : $r"; exit 1 }
"presse-papier = $mode -> $abs"

# 2) mettre WhatsApp au premier plan (AttachThreadInput, sinon Windows refuse le vol de focus)
$p = Get-Process -Name 'WhatsApp*' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'ECHEC : fenetre WhatsApp introuvable'; exit 1 }
$h = $p.MainWindowHandle

$moi = [K]::GetCurrentThreadId()
$lui = [K]::GetWindowThreadProcessId([K]::GetForegroundWindow(), [IntPtr]::Zero)
[void][K]::AttachThreadInput($moi, $lui, $true)
[void][K]::ShowWindow($h, 9)
[void][K]::BringWindowToTop($h)
[void][K]::SetForegroundWindow($h)
[void][K]::AttachThreadInput($moi, $lui, $false)
Start-Sleep -Milliseconds 1500

$ok = ([K]::GetForegroundWindow() -eq $h)
"foreground = $ok"
if (-not $ok) { 'ANNULE : WhatsApp pas au premier plan, Ctrl+V non envoye (il serait parti ailleurs)'; exit 1 }

# 3) Ctrl+V natif
[K]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[K]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[K]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
[K]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
'Ctrl+V natif envoye'
