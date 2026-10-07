param([Parameter(Mandatory = $true)][string]$Chemin)

# Attend la boite "Enregistrer sous" de WhatsApp, y ecrit le chemin complet et valide.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

$dossier = Split-Path $Chemin -Parent
if (-not (Test-Path $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }

$dlg = $null
for ($i = 0; $i -lt 40; $i++) {
    $procs = Get-Process -Name 'WhatsApp*' -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        foreach ($h in @($p.MainWindowHandle) + @($p.Threads | ForEach-Object { })) { }
    }
    $root = $AE::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    foreach ($w in $root.FindAll($TS::Children, $cond)) {
        $n = $w.Current.Name
        if ($n -match 'Save As|Enregistrer sous|Save') {
            $dlg = $w; break
        }
    }
    if ($dlg) { break }
    Start-Sleep -Milliseconds 400
}
if (-not $dlg) { 'ECHEC : boite de dialogue introuvable'; exit 1 }
"dialogue trouve : $($dlg.Current.Name)"

# champ "Nom du fichier"
$edits = $dlg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition(
            $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
if ($edits.Count -eq 0) { 'ECHEC : champ de saisie introuvable'; exit 1 }
$edit = $edits[0]
$vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue($Chemin)
Start-Sleep -Milliseconds 300

# bouton Enregistrer
$btns = $dlg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition(
            $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
$save = $null
foreach ($b in $btns) { if ($b.Current.Name -match '^(Save|Enregistrer)$') { $save = $b; break } }
if (-not $save) { 'ECHEC : bouton Enregistrer introuvable'; exit 1 }
$save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-Path $Chemin) { "OK : $Chemin ($((Get-Item $Chemin).Length) octets)"; exit 0 }
}
'ECHEC : fichier non ecrit'
exit 1
