# whatsapp-cli

Piloter WhatsApp en ligne de commande, pour qu'un assistant puisse **lire** les conversations,
**telecharger** les vocaux, photos et videos, **transcrire** les vocaux, et **envoyer du texte**.

Zero dependance : le CLI parle au moteur Chromium qui affiche WhatsApp, via le protocole CDP,
avec le `WebSocket` natif de Node 22.

- **Installation** : voir [INSTALL.md](INSTALL.md)
- **Portage macOS** : voir [MACOS.md](MACOS.md), ecrit pour l'assistant qui reprend le code

## Pourquoi c'est sans risque pour le compte

Le CLI ne parle **jamais** aux serveurs de Meta et n'implemente **aucun protocole non officiel**
(pas de Baileys, pas de whatsapp-web.js). Il manipule l'interface d'un client officiel deja
autorise par l'utilisateur : l'app WhatsApp Desktop sur Windows, WhatsApp Web dans Chrome ailleurs.
Il n'y a donc pas de nouvel appareil lie, et rien a bannir.

## Etat des capacites

Verifie le 07/10/2026 sur Windows 11, app WhatsApp du Microsoft Store.

| Capacite | Etat | Preuve |
|---|---|---|
| Lister les conversations | OK | texte exact, accents compris |
| Lire une conversation | OK | auteur + heure + texte, deplie les "Read more" |
| Ecrire un brouillon | OK | |
| Envoyer du texte | OK | message envoye et relu dans le fil |
| Telecharger les vocaux | OK | 7/7 puis 3/3 sur deux conversations |
| Transcrire les vocaux | OK | faster-whisper large-v3 |
| Telecharger les videos | OK | 3/3 via la galerie media |
| Telecharger les images | Partiel | la detection attrape aussi des vignettes qui ne sont pas des pieces jointes |
| Selection multiple | Non | la barre "Save as..." existe mais le clic groupe n'ecrit rien |
| **Envoyer une photo ou une video** | **Non** | 6 chemins essayes, journal ci-dessous |

## Commandes

```bash
node wa.js chats 20                 # liste des conversations (nom, heure, apercu)
node wa.js open "Alexandre"         # ouvre une conversation
node wa.js read 30                  # lit les N derniers messages (deplie les "Read more")
node wa.js expand                   # deplie seulement les messages tronques
node wa.js scroll 5                 # remonte l'historique de N crans
node wa.js draft "texte"            # ecrit dans la zone de saisie, SANS envoyer
WA_GO=oui node wa.js send           # envoie le brouillon en place
node wa.js shot sortie.png          # capture de la fenetre

node grab.js <dossier> vocaux       # tous les vocaux charges de la conversation ouverte
node grab.js <dossier> tous 10      # les 10 derniers medias
node grab-videos.js <dossier> 3     # les 3 dernieres videos, via la galerie
py transcrire.py <dossier>          # transcription de tous les .ogg du dossier

node js.js "document.title"         # evaluer du JS dans la page (mise au point)
```

## Garde-fou d'envoi

`send` refuse de partir sans `WA_GO=oui`. C'est volontaire : **un message a un tiers part sur go
explicite de l'utilisateur, a chaque fois**. Le flux correct est `open` puis `draft` puis
**verifier le destinataire** puis `send`.

Et surtout : **ne jamais annoncer un envoi sans avoir relu le fil ensuite**. Le script d'envoi de
media a affiche "envoye" deux fois alors que rien n'etait parti.

## Vocaux : ne jamais les jouer

Jouer un vocal pour capter le son envoie un accuse **"ecoute"** (micro bleu) a l'expediteur. Et de
toute facon WhatsApp ne cree ni balise `<audio>` ni blob : le decodage se fait hors de la page,
`decodeAudioData` et `createObjectURL` ne captent rien.

Le bon chemin est le menu contextuel du message puis **"Save as"**, avec
`Browser.setDownloadBehavior` qui redirige le telechargement : aucune boite de dialogue systeme,
aucune lecture, aucun accuse.

De meme, `open` marque la conversation comme **lue**. `chats` ne marque rien : pour surveiller sans
se trahir, boucler sur `chats`.

## Videos : passer par la galerie

Les videos ne se reperent pas de facon fiable dans le fil. Le chemin sur est le panneau
**Contact info puis "Media, links and docs"** : les vignettes qui portent une duree sont les
videos, de la plus recente a la plus ancienne. C'est ce que fait `grab-videos.js`. Si une video
ressort en echec, relancer avec `1` : c'est un temps de chargement, pas un probleme de chemin.

## Envoi de media : les 6 chemins qui ont echoue

Journal des essais, pour ne pas les refaire.

| Chemin | Resultat |
|---|---|
| `DOM.setFileInputFiles` sur l'input du DOM | le seul `input[type=file]` present est celui de la **photo de profil** |
| Coller simule (`ClipboardEvent` + `DataTransfer`) | ignore : WhatsApp exige `isTrusted` |
| Glisser-deposer simule (`DragEvent`) | ignore, meme raison |
| Glisser-deposer natif (`Input.dispatchDragEvent` + `files`) | **l'apercu s'ouvre**, donc l'evenement est accepte, mais il reste bloque sur un spinner |
| `Page.setInterceptFileChooserDialog` + `setFileInputFiles` sur le `backendNodeId` | `fileChooserOpened` bien recu (`mode: selectMultiple`), mais aucun apercu ne suit |
| Presse-papier systeme reel + Ctrl+V natif | Windows a refuse de donner le focus a la fenetre ; sans focus le Ctrl+V partirait dans une autre application, donc un garde-fou annule |

Le menu Attach s'ouvre pourtant bien (`Document / Photos & videos / Camera / Audio / Contact /
Poll / New sticker`), le blocage est apres. Sur macOS la derniere ligne est la plus prometteuse,
voir [MACOS.md](MACOS.md).

## Pieges d'interface deja payes

- `Escape` **ferme la conversation**, ce n'est pas un "annuler" inoffensif.
- Ne jamais filtrer un bouton sur `/play/i` : "Change **play**back speed" matche, et on change la
  vitesse de lecture de l'utilisateur. Utiliser `/^(play|pause) voice/i`.
- Un `div[role="row"]` fait **toute la largeur** : cliquer en son centre tombe a cote de la bulle et
  ouvre le menu de la conversation au lieu du menu du message. Viser le bouton Play + 45 px.
- Toujours `scrollIntoView({block:'center'})` puis **re-mesurer juste avant de cliquer** : la liste
  bouge des qu'un message arrive.
- Les conversations ET les messages sont des `div[role="row"]`, portee `#pane-side` pour la liste,
  `#main` pour les messages. Il n'y a **pas** de `role="listitem"`.
- Le couple auteur + horodatage exact se lit dans l'attribut `data-pre-plain-text`.
- Un clic rate dans la galerie laisse parfois un volet **bloque sur un spinner** par-dessus la
  conversation. Le fermer via le bouton `aria-label="Close"`.
- Les essais d'envoi ratés **remplissent la zone de saisie** de leurs legendes. Toujours la vider
  ensuite, sinon l'utilisateur envoie ca sans le vouloir.

## Donnees

Le `.gitignore` bloque medias, transcriptions et dossiers d'export. **Le code oui, les
conversations jamais.** Les exports vont ailleurs que dans ce dossier.
