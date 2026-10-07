# Installation

## Prerequis
- **Node.js 22+** (le CLI utilise le `WebSocket` natif de Node, sans aucune dependance npm)
- **Python 3 + faster-whisper** uniquement si tu veux transcrire les vocaux :
  `pip install faster-whisper`

Aucun `npm install` : le CLI n'a **zero dependance**.

## macOS / Linux
```bash
chmod +x wa-start.sh
./wa-start.sh          # lance Chrome avec le port de debogage + WhatsApp Web
                       # scanner le QR code la premiere fois
node wa.js chats 10
```

## Windows
```powershell
pwsh -NoProfile -File .\wa-start.ps1   # relance l'app WhatsApp du Store avec le port 9222
node wa.js chats 10
```

## Verifier que tout repond
```bash
node wa.js chats 5
node wa.js open "Nom du contact"
node wa.js read 10
```

Si `page WhatsApp introuvable`, c'est que le port n'est pas ouvert : relancer le script de
demarrage de ta plateforme.
