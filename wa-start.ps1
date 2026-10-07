# Relance WhatsApp avec le port de debogage WebView2 ouvert (necessaire pour wa.js).
# La variable d'environnement est posee puis RETIREE aussitot : elle ne vaut que pour ce
# lancement, aucune autre app WebView2 de la machine n'ouvre de port.
$ErrorActionPreference = 'Stop'
[Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '--remote-debugging-port=9222', 'User')
try {
    Get-Process -Name 'WhatsApp*' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $full = (Get-AppxPackage -Name '5319275A.WhatsAppDesktop').PackageFamilyName + '!App'
    Start-Process "shell:AppsFolder\$full"
    Start-Sleep -Seconds 12
}
finally {
    [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'User')
}
if (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue) {
    'port 9222 ouvert, wa.js est utilisable'
}
else {
    'ECHEC : port 9222 ferme'
    exit 1
}
