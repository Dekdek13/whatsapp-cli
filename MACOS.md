# Portage macOS : note pour l'assistant qui reprend ce code

Ce dossier a ete ecrit et teste sur **Windows 11**, contre l'application WhatsApp du Microsoft Store.
Voici exactement ce qui se transpose tel quel sur macOS et ce qui ne se transpose pas. Le but est
de t'eviter de refaire les essais qui ont deja echoue ici.

## Le point qui change tout

Sur Windows, l'app WhatsApp du Store est un **WebView2**, donc un moteur Chromium : on la relance
avec `--remote-debugging-port=9222` et on pilote son DOM en CDP.

Sur macOS, **WhatsApp Desktop est une application Catalyst native**. Pas de Chromium, pas de port
de debogage, pas de DOM. Le chemin Windows n'existe pas.

**Le chemin portable est donc WhatsApp Web dans un Chrome dedie**, lance par `wa-start.sh`. Et la
bonne nouvelle est que **le reste du CLI ne change pas** : `ui.js` cherche l'onglet dont l'URL
contient `web.whatsapp.com`, peu importe qui l'heberge. Les selecteurs DOM sont ceux de
`web.whatsapp.com`, identiques dans les deux cas.

## Ce qui marche sans rien changer

`wa.js` (chats, open, read, expand, scroll, draft, send, shot), `js.js`, `ui.js`, `grab.js`,
`grab-ptt.js`, `grab-videos.js`. Tous ne font que du CDP sur l'onglet.

Un seul detail : le dossier de telechargement passe a `Browser.setDownloadBehavior` est en chemin
Windows (antislashs) dans les scripts `grab*`. Sur macOS, passer le chemin POSIX tel quel.

## Ce qui est a jeter ou a reecrire

| Fichier | Sort sur macOS |
|---|---|
| `wa-start.ps1` | remplace par `wa-start.sh` |
| `save-dialog.ps1`, `open-dialog.ps1` | inutiles : ils pilotent des boites de dialogue Windows en UIAutomation. Sur macOS, l'equivalent serait AppleScript / Accessibilite, mais la redirection des telechargements au niveau du protocole rend la boite inutile |
| `paste-natif.ps1` | a reecrire en AppleScript si tu tentes l'envoi de media (voir plus bas) |
| `transcrire.py` | marche, mais `device="cuda"` doit devenir `device="cpu"` (ou `compute_type="int8"`), il n'y a pas de CUDA sur Mac |

## Le probleme non resolu : envoyer une photo ou une video

Six chemins ont ete essayes sur Windows, tous ont echoue. Ne les refais pas a l'identique :

| Chemin | Resultat Windows |
|---|---|
| `DOM.setFileInputFiles` sur l'input du DOM | le seul `input[type=file]` present est celui de la photo de profil |
| Coller simule (`ClipboardEvent` + `DataTransfer`) | ignore : WhatsApp exige `isTrusted` |
| Glisser-deposer simule (`DragEvent`) | ignore, meme raison |
| Glisser-deposer natif (`Input.dispatchDragEvent` avec `files`) | l'apercu s'ouvre (donc l'evenement est accepte) mais reste bloque sur un spinner |
| `Page.setInterceptFileChooserDialog` + `setFileInputFiles` sur le `backendNodeId` | `fileChooserOpened` bien recu (`mode: selectMultiple`), mais aucun apercu ne suit |
| Presse-papier Windows reel + Ctrl+V natif | **non concluant** : Windows a refuse de donner le focus a la fenetre WhatsApp, et sans focus le Ctrl+V serait parti dans une autre application. Un garde-fou annule l'envoi dans ce cas |

**Sur macOS, la derniere ligne est la plus prometteuse** : mettre le fichier dans le presse-papier
puis envoyer un Cmd+V reel. macOS ne bloque pas la prise de focus comme Windows, donc ce qui a
coince ici ne coincera probablement pas la-bas :

```applescript
set the clipboard to (read (POSIX file "/chemin/photo.jpg") as JPEG picture)
tell application "Google Chrome" to activate
tell application "System Events" to keystroke "v" using command down
```

Cela demande d'autoriser le terminal dans Reglages Systeme, Confidentialite et securite,
Accessibilite. A tester avant d'annoncer quoi que ce soit.

## Regle de verification, non negociable

Le script d'envoi a affiche "envoye" **deux fois alors que rien n'etait parti**. Ne jamais annoncer
un envoi sans avoir **relu le fil de la conversation** apres coup (`node wa.js chats 1` et regarder
l'apercu, ou `node wa.js read 3`). Cette regle vaut pour le texte comme pour les medias.

## Pieges d'interface deja payes

- `Escape` **ferme la conversation**, ce n'est pas un "annuler" inoffensif.
- Ne jamais filtrer un bouton sur `/play/i` : "Change **play**back speed" matche, et on change la
  vitesse de lecture de l'utilisateur sans s'en rendre compte.
- Un `div[role="row"]` fait **toute la largeur** : cliquer en son centre tombe a cote de la bulle et
  ouvre le menu de la conversation au lieu du menu du message. Viser le bouton Play + 45 px.
- Toujours `scrollIntoView({block:'center'})` puis **re-mesurer juste avant de cliquer** : la liste
  bouge des qu'un message arrive.
- Les conversations ET les messages sont des `div[role="row"]`. Il n'y a **pas** de `role="listitem"`.
- Un clic rate dans la galerie peut laisser un volet **bloque sur un spinner** par-dessus la
  conversation. Le fermer via le bouton `aria-label="Close"`.
- Les messages vocaux : **ne jamais les jouer** pour recuperer le son. Cela envoie un accuse
  "ecoute" (micro bleu) a l'expediteur, et de toute facon WhatsApp ne cree ni balise `<audio>` ni
  blob : le decodage se fait hors de la page. Passer par le menu contextuel puis "Save as".
- Les videos ne se reperent pas de facon fiable dans le fil. Passer par le panneau Contact info
  puis "Media, links and docs" : les vignettes portant une duree sont les videos.
