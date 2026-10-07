#!/usr/bin/env node
// auto-reply.js - repond automatiquement aux messages d'un contact WhatsApp.
//
// Usage :
//   node auto-reply.js "Maman"
//   node auto-reply.js "Alexandre" --periode 30 --max 10 --heures 4
//   node auto-reply.js "Maman" --consigne "Tu es chaleureux et tres bref."
//   node auto-reply.js "Maman" --sec                 # mode sec : rediger mais NE PAS envoyer
//
// Arret : creer le fichier <Downloads>\STOP-<CONTACT>  (ou tuer le process)
// Journal : <Downloads>\auto-reply-<contact>.log
//
// ATTENTION : c'est le seul endroit du CLI ou un message part sans go explicite a chaque fois.
// A n'activer que sur une conversation ou l'utilisateur l'a demande, et apres avoir prevenu
// l'interlocuteur qu'il parle a un assistant.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const CONTACT = argv.find(a => !a.startsWith('--'));
if (!CONTACT) {
  console.error('usage : node auto-reply.js "<contact>" [--periode 20] [--max 30] [--heures 12] [--consigne "..."] [--sec]');
  process.exit(1);
}
const opt = (nom, defaut) => {
  const i = argv.indexOf('--' + nom);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : defaut;
};
const PERIODE   = Number(opt('periode', 20)) * 1000;
const MAX_REPS  = Number(opt('max', 30));
const MAX_DUREE = Number(opt('heures', 12)) * 3600 * 1000;
const CONSIGNE  = opt('consigne', '');
const SEC       = argv.includes('--sec');

const slug = CONTACT.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
const DL   = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads');
const STOP = path.join(DL, 'STOP-' + CONTACT.toUpperCase());
const LOG  = path.join(DL, `auto-reply-${slug}.log`);
const ETAT = path.join(__dirname, `.auto-reply-${slug}.json`);
const ICI  = __dirname;

/* ---------- moteur de reponse ---------- */
// Sur Windows, "claude" dans le PATH est un shim shell que child_process ne sait pas lancer
// (ENOENT). Il faut viser le vrai binaire.
function trouveClaude() {
  const c = [
    process.env.CLAUDE_BIN,
    path.join(process.env.APPDATA || '', 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'),
    'C:/Users/Yanis/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
    path.join(process.env.HOME || '', '.local/bin/claude'),
    '/usr/local/bin/claude',
  ].filter(Boolean);
  for (const x of c) { try { if (fs.existsSync(x)) return x; } catch {} }
  return 'claude';
}
const CLAUDE = trouveClaude();

/* ---------- sujets ou on ne s'engage pas ---------- */
const SENSIBLE = /(argent|euros?|€|rembours|dette|pr[eê]t|virement|taxi|sasu|notaire|banque|imp[oô]t|contrat|avocat|urssaf|facture|devis|salaire)/i;

/* ---------- utilitaires ---------- */
const log = (...m) => {
  const l = `[${new Date().toLocaleString('fr-FR')}] ${m.join(' ')}`;
  console.log(l);
  try { fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch {}
};
const wa = (args, env = {}) =>
  execFileSync('node', [path.join(ICI, 'wa.js'), ...args],
    { cwd: ICI, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
const dors = ms => new Promise(r => setTimeout(r, ms));
const etatLu = () => { try { return JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch { return {}; } };
const etatEcrit = e => { try { fs.writeFileSync(ETAT, JSON.stringify(e), 'utf8'); } catch {} };

function redige(historique, dernier) {
  const contexte = historique.map(m => `${m.auteur || '?'} : ${m.texte.replace(/\n/g, ' ')}`).join('\n');
  const consigne = [
    `Tu es un assistant qui repond sur WhatsApp a "${CONTACT}", a la place de son proprietaire et avec son accord.`,
    "L'interlocuteur sait qu'il parle a un assistant, il a ete prevenu.",
    CONSIGNE || "Reponds en francais, chaleureux, court (1 a 3 phrases), ton de message WhatsApp.",
    "N'utilise jamais de tiret cadratin ni de double tiret.",
    "N'invente aucun fait : si tu ne sais pas, dis que tu transmets.",
    SENSIBLE.test(dernier.texte)
      ? "ATTENTION : ce message touche a l'argent ou au juridique. Ne t'engage sur RIEN, reste chaleureux et dis que le proprietaire du compte repondra lui-meme la-dessus."
      : '',
    "Ecris UNIQUEMENT le message a envoyer, rien d'autre, pas de guillemets, pas de prefixe.",
    '',
    "Contexte, les derniers messages (NE PAS y repondre, c'est du passe) :",
    contexte,
    '',
    `LE SEUL MESSAGE AUQUEL TU REPONDS, de ${dernier.auteur} : "${dernier.texte.replace(/\n/g, ' ')}"`,
    "Reponds a CE message precisement. Ne reprends aucun chiffre ni aucun sujet des messages plus",
    "anciens. Si ce message est tres court (\"ok\", \"cool\", \"d'accord\"), reponds court et chaleureux,",
    "ou relance simplement sur comment va la personne.",
  ].filter(Boolean).join('\n');

  let out = execFileSync(CLAUDE, ['-p', '--model', 'sonnet', consigne], { encoding: 'utf8', timeout: 180_000 });
  // le CLAUDE.md du poste impose de commencer par un prenom : on retire ce prefixe parasite
  out = out.trim().replace(/^Yanis\s*[,:]?\s*/i, '').trim();
  return out.replace(/^["«]\s*/, '').replace(/\s*["»]$/, '').trim();
}

/* ---------- boucle ---------- */
(async () => {
  fs.appendFileSync(LOG, `\n===== demarrage ${new Date().toLocaleString('fr-FR')} =====\n`, 'utf8');
  log(`contact "${CONTACT}" | verification toutes les ${PERIODE / 1000} s | plafond ${MAX_REPS} reponses | ${MAX_DUREE / 3600000} h`);
  log(`moteur : ${CLAUDE}${SEC ? ' | MODE SEC : rien ne sera envoye' : ''}`);
  log(`arret : creer ${STOP}`);

  const debut = Date.now();
  const etat = etatLu();
  let reponses = 0;

  // si aucun etat, marquer le dernier message comme deja traite (ne pas repondre a l'historique)
  if (!etat.derniere) {
    try {
      wa(['open', CONTACT]); await dors(2500);
      const fil = JSON.parse(wa(['read', '8']));
      const n = (fil.messages || []).filter(m => m.auteur);
      const d = n[n.length - 1];
      if (d) { etat.derniere = `${d.auteur}|${d.heure}|${d.texte.slice(0, 80)}`; etatEcrit(etat); }
      log(`amorce : dernier message deja traite -> ${d ? d.auteur + ' / ' + d.texte.slice(0, 50) : '(aucun)'}`);
    } catch (e) { log('amorce impossible : ' + e.message); }
  }

  while (true) {
    if (fs.existsSync(STOP)) { log('fichier STOP trouve, arret'); break; }
    if (Date.now() - debut > MAX_DUREE) { log('duree maximale atteinte, arret'); break; }
    if (reponses >= MAX_REPS) { log('plafond de reponses atteint, arret'); break; }

    try {
      // 1) sonder SANS ouvrir la conversation : "chats" ne marque rien comme lu et ne vole pas
      // la conversation ouverte aux autres outils qui pilotent la meme app.
      const liste = JSON.parse(wa(['chats', '25']));
      const ligne = liste.find && liste.find(c => (c.name || '').toLowerCase().includes(CONTACT.toLowerCase()));
      if (!ligne) { log(`contact "${CONTACT}" absent de la liste visible, on repasse plus tard`); await dors(PERIODE); continue; }

      const empreinte = `${ligne.time}|${ligne.preview}`;
      const rienDeNeuf = empreinte === etat.apercu;
      const cEstMoi = etat.dernierEnvoi && ligne.preview.startsWith(etat.dernierEnvoi.slice(0, 40));
      if (rienDeNeuf || cEstMoi) {
        if (!rienDeNeuf) { etat.apercu = empreinte; etatEcrit(etat); }
        await dors(PERIODE);
        continue;
      }
      etat.apercu = empreinte;

      // 2) seulement maintenant, ouvrir pour lire le detail et repondre
      const ouverte = JSON.parse(wa(['read', '1'])).conversation || '';
      if (!ouverte.toLowerCase().includes(CONTACT.toLowerCase())) { wa(['open', CONTACT]); await dors(2500); }

      const fil = JSON.parse(wa(['read', '8']));
      const nommes = (fil.messages || []).filter(m => m.auteur);
      const dernier = nommes[nommes.length - 1];
      const moi = nommes.filter(m => m.sortant).map(m => m.auteur)[0];

      if (dernier && dernier.auteur !== 'Yanis' && dernier.auteur !== moi) {
        const signature = `${dernier.auteur}|${dernier.heure}|${dernier.texte.slice(0, 80)}`;
        if (signature !== etat.derniere) {
          log(`recu de ${dernier.auteur} (${dernier.heure}) : ${dernier.texte.slice(0, 140)}`);
          const reponse = redige(nommes.slice(-8), dernier);

          if (!reponse || reponse.length > 700) {
            log(`reponse ecartee (${reponse.length} caracteres), rien envoye`);
          } else if (SEC) {
            log(`MODE SEC, aurait envoye : ${reponse}`);
          } else {
            wa(['draft', reponse]); await dors(800);
            wa(['send'], { WA_GO: 'oui' }); await dors(2500);
            const apres = JSON.parse(wa(['read', '2']));
            const vu = (apres.messages || []).some(m => m.texte.includes(reponse.slice(0, 30)));
            log(`${vu ? 'ENVOYE et relu' : 'ENVOI NON CONFIRME'} : ${reponse}`);
            etat.dernierEnvoi = reponse; etatEcrit(etat);
            if (SENSIBLE.test(dernier.texte)) log('  ^ sujet sensible, a relire');
            reponses++;
          }
          etat.derniere = signature;
          etatEcrit(etat);
        }
      }
    } catch (e) {
      log('erreur de boucle : ' + String(e.message).slice(0, 200));
    }
    await dors(PERIODE);
  }
  log(`arret apres ${reponses} reponse(s)`);
})();
