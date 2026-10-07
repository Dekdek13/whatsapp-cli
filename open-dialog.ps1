param([Parameter(Mandatory = $true)][string]$Chemin)

# Attend la boite "Ouvrir" de WhatsApp, y ecrit le chemin complet et valide.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

if (-not (Test-Path $Chemin)) { "ECHEC : fichier absent $Chemin"; exit 1 }

$dlg = $null
for ($i = 0; $i -lt 50; $i++) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    foreach ($w in $AE::RootElement.FindAll($TS::Children, $cond)) {
        if ($w.Current.ClassName -eq '#32770' -or $w.Current.Name -match '^(Open|Ouvrir)') { $dlg = $w; break }
    }
    if ($dlg) { break }
    Start-Sleep -Milliseconds 300
}
if (-not $dlg) { 'ECHEC : boite Ouvrir introuvable'; exit 1 }
"dialogue : $($dlg.Current.Name) [$($dlg.Current.ClassName)]"

$edits = $dlg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition(
            $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
if ($edits.Count -eq 0) { 'ECHEC : champ de saisie introuvable'; exit 1 }

$edit = $edits[0]
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Chemin)
Start-Sleep -Milliseconds 400

$btns = $dlg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition(
            $AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
$ouvrir = $null
foreach ($b in $btns) { if ($b.Current.Name -match '^(Open|Ouvrir)$') { $ouvrir = $b; break } }
if (-not $ouvrir) { 'ECHEC : bouton Ouvrir introuvable'; exit 1 }
$ouvrir.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
'OK : fichier transmis a WhatsApp'
