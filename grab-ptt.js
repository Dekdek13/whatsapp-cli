#!/usr/bin/env node
// grab-ptt.js - enregistre sur le disque tous les messages vocaux de la conversation ouverte.
//
// Chemin utilise : menu contextuel du message -> "Save as", avec les telechargements rediriges
// au niveau du protocole (Browser.setDownloadBehavior). Donc : aucune boite de dialogue Windows,
// et surtout AUCUNE lecture, donc pas d'accuse "ecoute" (micro bleu) pour l'expediteur.
//
// Usage : node grab-ptt.js <dossier> [nombre]
//   nombre = combien reprendre en partant du plus recent (defaut : tous ceux charges)

const { main } = require('./ui.js');
const fs = require('node:fs');

const DOSSIER = (process.argv[2] || 'C:/Users/Yanis/Downloads/vocaux-whatsapp').replace(/\\/g, '/');
const COMBIEN = parseInt(process.argv[3] || '0') || 0;

const LISTE = `(()=>{
  const m = document.querySelector('#main');
  if (!m) return JSON.stringify({err:'aucune conversation ouverte'});
  const rows = [...m.querySelectorAll('div[role="row"]')];
  const out = [];
  rows.forEach((r, i) => {
    if (!r.querySelector('span[data-icon="ptt-status"]')) return;
    const t = r.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean);
    out.push({ i,
      duree: t.find(x => /^[0-9]+:[0-9][0-9]$/.test(x)) || '',
      heure: t[t.length-1] || '',
      sortant: !!r.querySelector('.message-out') });
  });
  return JSON.stringify(out);
})()`;

const POS = idx => `(()=>{
  const row = [...document.querySelectorAll('#main div[role="row"]')][${idx}];
  if (!row) return JSON.stringify({err:'ligne absente'});
  const b = [...row.querySelectorAll('button,[role="button"]')]
    .find(x => /^(play|pause) voice/i.test(x.getAttribute('aria-label') || ''));
  if (!b) return JSON.stringify({err:'pas de bouton play'});
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.right + 45), y: Math.round(r.top + r.height/2) });
})()`;

const MENU = `(()=>{
  const o=[];
  for (const e of document.querySelectorAll('li,[role="menuitem"],div[role="button"]')) {
    const t=(e.innerText||'').trim();
    if(!t || t.indexOf(String.fromCharCode(10))>=0 || t.length>24) continue;
    const r=e.getBoundingClientRect();
    if(r.width<80 || r.height<22 || r.height>60) continue;
    o.push({t, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
  }
  return JSON.stringify(o);
})()`;

(async () => {
  const d = await main();
  fs.mkdirSync(DOSSIER, { recursive: true });

  // rediriger les telechargements : plus aucune boite de dialogue Windows
  await d.call('Browser.setDownloadBehavior',
    { behavior: 'allow', downloadPath: DOSSIER.replace(/\//g, '\\'), eventsEnabled: true });

  let liste = JSON.parse(await d.js(LISTE));
  if (liste.err) { console.log(liste.err); d.close(); return; }
  if (COMBIEN) liste = liste.slice(-COMBIEN);
  console.log(`${liste.length} vocal(s) -> ${DOSSIER}`);

  const faits = [];
  for (const v of liste) {
    const avant = fs.readdirSync(DOSSIER);

    await d.js(`(()=>{const r=[...document.querySelectorAll('#main div[role="row"]')][${v.i}];
                 if(r) r.scrollIntoView({block:'center'});})()`);
    await d.wait(800);

    const c = JSON.parse(await d.js(POS(v.i)));
    if (c.err) { faits.push({ ...v, erreur: c.err }); continue; }

    await d.move(c.x, c.y); await d.wait(250);
    await d.click(c.x, c.y, 'right'); await d.wait(1100);

    const items = JSON.parse(await d.js(MENU));
    const save = items.find(i => /^(save as|enregistrer sous)$/i.test(i.t));
    if (!save) { faits.push({ ...v, erreur: 'menu sans Save as : ' + items.map(i => i.t).join(',') }); continue; }

    await d.click(save.x, save.y);

    let nouveau = null;
    for (let k = 0; k < 25 && !nouveau; k++) {
      await d.wait(400);
      nouveau = fs.readdirSync(DOSSIER).find(f => !avant.includes(f) && !f.endsWith('.crdownload'));
    }
    faits.push({ ...v, fichier: nouveau, ok: !!nouveau });
    await d.wait(400);
  }

  console.log(JSON.stringify(faits, null, 2));
  d.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
