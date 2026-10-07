#!/usr/bin/env node
// send-media.js - envoie une photo ou une video dans la conversation ouverte.
//
// Chemin retenu apres essais : menu "Attach" -> "Photos & videos", avec le selecteur de fichier
// INTERCEPTE au niveau du protocole (Page.setInterceptFileChooserDialog). On fournit alors le
// chemin au champ via DOM.setFileInputFiles : aucune boite de dialogue Windows a piloter.
//
// Ce qui ne marche PAS, teste le 07/10/2026 :
//   - coller simule (ClipboardEvent) : ignore, WhatsApp exige isTrusted
//   - glisser-deposer simule (DragEvent) : ignore, meme raison
//   - glisser-deposer natif (Input.dispatchDragEvent) : l'apercu s'ouvre mais reste sur un spinner
//
// Usage : WA_GO=oui node send-media.js <fichier> ["legende"]

const { main } = require('./ui.js');
const fs = require('node:fs');
const path = require('node:path');

const FICHIER = process.argv[2];
const LEGENDE = process.argv.slice(3).join(' ');

(async () => {
  if (!FICHIER || !fs.existsSync(FICHIER)) { console.error('fichier introuvable : ' + FICHIER); process.exit(1); }
  if (process.env.WA_GO !== 'oui') { console.error('envoi bloque : WA_GO=oui requis'); process.exit(1); }

  const d = await main();
  const abs = path.resolve(FICHIER);

  // etat propre
  await d.js(`(()=>{const c=[...document.querySelectorAll('[aria-label]')].filter(e=>/^close$/i.test((e.getAttribute('aria-label')||'').trim()));c.forEach(e=>e.click());})()`);
  await d.wait(1000);

  const dest = await d.js(`(()=>{const h=document.querySelector('#main header');return h?h.innerText.split(String.fromCharCode(10))[0]:null;})()`);
  if (!dest) { console.error('aucune conversation ouverte'); d.close(); return; }
  console.log('destinataire :', dest, '| fichier :', path.basename(abs));

  // 1) intercepter le selecteur de fichier
  await d.call('Page.enable');
  await d.call('Page.setInterceptFileChooserDialog', { enabled: true });

  // 2) ouvrir le menu Attach
  const a = JSON.parse(await d.js(`(()=>{
    for(const e of document.querySelectorAll('#main footer [aria-label]')){
      if(!/^attach$/i.test((e.getAttribute('aria-label')||'').trim())) continue;
      const r=e.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    } return JSON.stringify(null);})()`));
  if (!a) { console.error('bouton Attach introuvable'); d.close(); return; }
  const CHERCHE_PV = `(()=>{
    for(const e of document.querySelectorAll('li,[role="menuitem"],div[role="button"],span')){
      const t=(e.innerText||'').trim();
      if(t.length>28 || !/photo/i.test(t) || !/vid/i.test(t)) continue;
      const r=e.getBoundingClientRect();
      if(r.width<60 || r.height<18) continue;
      return JSON.stringify({t, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
    } return JSON.stringify(null);})()`;

  // 3) ouvrir le menu (re-cliquer si besoin) puis cliquer "Photos & videos"
  let pv = null;
  for (let essai = 0; essai < 3 && !pv; essai++) {
    await d.move(a.x, a.y); await d.wait(400);
    await d.click(a.x, a.y); await d.wait(1800);
    pv = JSON.parse(await d.js(CHERCHE_PV));
    if (!pv) console.log(`  menu Attach pas ouvert (essai ${essai + 1})`);
  }
  if (!pv) { console.error('entree "Photos & videos" introuvable'); d.close(); return; }
  console.log('entree trouvee :', pv.t);

  const attente = d.once('Page.fileChooserOpened', 15000);
  await d.click(pv.x, pv.y);
  let chooser;
  try { chooser = await attente; } catch (e) { console.error('selecteur de fichier non intercepte : ' + e.message); d.close(); return; }
  console.log('selecteur intercepte, mode =', chooser.mode);

  await d.call('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [abs] });
  await d.wait(5000);

  // 4) verifier que l'apercu est bien charge (pas un spinner)
  const etat = JSON.parse(await d.js(`(()=>{
    const btn = [...document.querySelectorAll('[aria-label]')]
      .find(e => /^(send|envoyer)$/i.test((e.getAttribute('aria-label')||'').trim())
                 && e.getBoundingClientRect().width > 16 && e.getBoundingClientRect().top > window.innerHeight*0.5);
    const media = document.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').length;
    if (!btn) return JSON.stringify({pret:false, media});
    const r = btn.getBoundingClientRect();
    return JSON.stringify({pret:true, media, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
  })()`));
  console.log('apercu :', JSON.stringify(etat));
  if (!etat.pret) { console.error('ECHEC : apercu non pret, rien envoye'); d.close(); return; }

  // 5) legende puis envoi
  if (LEGENDE) {
    await d.js(`(()=>{const b=[...document.querySelectorAll('div[contenteditable="true"]')].pop();
      if(b){b.focus();const r=document.createRange();r.selectNodeContents(b);
      const s=getSelection();s.removeAllRanges();s.addRange(r);}})()`);
    await d.call('Input.insertText', { text: LEGENDE });
    await d.wait(600);
  }
  await d.click(etat.x, etat.y);
  await d.wait(5000);

  // 6) PREUVE : relire le fil
  const preuve = await d.js(`(()=>{
    const rows=[...document.querySelectorAll('#main div[role="row"]')].slice(-3);
    return JSON.stringify(rows.map(r=>({
      txt:r.innerText.split(String.fromCharCode(10)).filter(Boolean).join(' | ').slice(0,60),
      media:!!r.querySelector('img[src^="blob:"], video, span[data-icon="media-play"]')})));
  })()`);
  console.log('3 derniers elements du fil :', preuve);
  d.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
