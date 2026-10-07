#!/usr/bin/env node
// grab.js - enregistre sur le disque les medias de la conversation ouverte :
// messages vocaux, images, videos, documents.
//
// Chemin : menu contextuel du message -> "Save as", telechargements rediriges au niveau du
// protocole (Browser.setDownloadBehavior). Donc aucune boite de dialogue Windows, et pour les
// vocaux aucune lecture, donc pas d'accuse "ecoute" (micro bleu) pour l'expediteur.
//
// Usage : node grab.js <dossier> [type] [nombre]
//   type   : vocaux | images | videos | documents | tous   (defaut : tous)
//   nombre : combien reprendre en partant du plus recent   (defaut : tous ceux charges)

const { main } = require('./ui.js');
const fs = require('node:fs');

const DOSSIER = (process.argv[2] || 'C:/Users/Yanis/Downloads/whatsapp-medias').replace(/\\/g, '/');
const TYPE = (process.argv[3] || 'tous').toLowerCase();
const COMBIEN = parseInt(process.argv[4] || '0') || 0;

// Reperage par type. Les selecteurs sont volontairement larges : WhatsApp change ses classes,
// mais les data-icon et les balises media restent stables.
const LISTE = `(()=>{
  const m = document.querySelector('#main');
  if (!m) return JSON.stringify({err:'aucune conversation ouverte'});
  const rows = [...m.querySelectorAll('div[role="row"]')];
  const out = [];
  rows.forEach((r, i) => {
    let type = null;
    if (r.querySelector('span[data-icon="ptt-status"]')) type = 'vocal';
    else if (r.querySelector('span[data-icon="media-play"], video')) type = 'video';
    else if (r.querySelector('img[src^="blob:"]')) type = 'image';
    else if (r.querySelector('span[data-icon^="document"], span[data-icon="audio-file"]')) type = 'document';
    if (!type) return;
    const t = r.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean);
    out.push({ i, type,
      duree: t.find(x => /^[0-9]+:[0-9][0-9]$/.test(x)) || '',
      heure: t.find(x => /[0-9]{1,2}:[0-9]{2}\\s*(AM|PM)/i.test(x)) || t[t.length-1] || '',
      sortant: !!r.querySelector('.message-out') });
  });
  return JSON.stringify(out);
})()`;

// point de clic droit : sur la bulle elle-meme, pas sur la ligne (qui fait toute la largeur)
const POS = idx => `(()=>{
  const row = [...document.querySelectorAll('#main div[role="row"]')][${idx}];
  if (!row) return JSON.stringify({err:'ligne absente'});
  const play = [...row.querySelectorAll('button,[role="button"]')]
    .find(x => /^(play|pause) voice/i.test(x.getAttribute('aria-label') || ''));
  let r;
  if (play) { const b = play.getBoundingClientRect(); r = {x: b.right + 45, y: b.top + b.height/2}; }
  else {
    const el = row.querySelector('img[src^="blob:"], video, span[data-icon^="document"]')
            || row.querySelector('.message-in, .message-out') || row;
    const b = el.getBoundingClientRect();
    r = {x: b.left + b.width/2, y: b.top + b.height/2};
  }
  return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y) });
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
  await d.call('Browser.setDownloadBehavior',
    { behavior: 'allow', downloadPath: DOSSIER.replace(/\//g, '\\'), eventsEnabled: true });

  let liste = JSON.parse(await d.js(LISTE));
  if (liste.err) { console.log(liste.err); d.close(); return; }
  const filtres = { vocaux: 'vocal', images: 'image', videos: 'video', documents: 'document' };
  if (filtres[TYPE]) liste = liste.filter(x => x.type === filtres[TYPE]);
  if (COMBIEN) liste = liste.slice(-COMBIEN);

  const parType = liste.reduce((a, x) => (a[x.type] = (a[x.type] || 0) + 1, a), {});
  console.log(`${liste.length} media(s) ${JSON.stringify(parType)} -> ${DOSSIER}`);

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
    const save = items.find(i => /^(save as|enregistrer sous|download|telecharger)/i.test(i.t));
    if (!save) {
      faits.push({ ...v, erreur: 'menu sans Save as : ' + items.map(i => i.t).join(',') });
      await d.click(40, 300); await d.wait(300);   // refermer le menu
      continue;
    }
    await d.click(save.x, save.y);

    let nouveau = null;
    for (let k = 0; k < 30 && !nouveau; k++) {
      await d.wait(400);
      nouveau = fs.readdirSync(DOSSIER).find(f => !avant.includes(f) && !f.endsWith('.crdownload'));
    }
    faits.push({ ...v, fichier: nouveau, ok: !!nouveau });
    await d.wait(300);
  }

  const ok = faits.filter(f => f.ok).length;
  console.log(`${ok}/${faits.length} enregistre(s)`);
  console.log(JSON.stringify(faits, null, 2));
  d.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
