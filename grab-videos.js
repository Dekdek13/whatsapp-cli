#!/usr/bin/env node
// grab-videos.js - telecharge les N dernieres videos de la conversation ouverte,
// via sa galerie media (panneau Contact info -> "Media, links and docs").
// Prerequis : la galerie doit etre ouverte, ou le script l'ouvre lui-meme.
//
// Usage : node grab-videos.js <dossier> [nombre]

const { main } = require('./ui.js');
const fs = require('node:fs');

const DOSSIER = (process.argv[2] || 'C:/Users/Yanis/Downloads/whatsapp-videos').replace(/\\/g, '/');
const N = parseInt(process.argv[3] || '3') || 3;

// vignettes de la galerie reperees par leur duree (une video a une duree, pas une photo)
const VIGNETTES = `(()=>{
  const re = /^[0-9]+:[0-9][0-9]$/;
  const o = [];
  for (const e of document.querySelectorAll('div,span')) {
    const t = (e.innerText || '').trim();
    if (!re.test(t)) continue;
    const r = e.getBoundingClientRect();
    if (r.left < window.innerWidth * 0.55) continue;
    if (r.width < 90) continue;                      // la grosse boite = la vignette
    if (r.top < 150 || r.bottom > window.innerHeight - 20) continue;
    o.push({ t, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
  }
  const vus = new Set(); const u = [];
  for (const i of o) { const k = i.t + '@' + i.y; if (vus.has(k)) continue; vus.add(k); u.push(i); }
  return JSON.stringify(u);
})()`;

const BOUTON = motif => `(()=>{
  for (const e of document.querySelectorAll('button,[role="button"],[aria-label]')) {
    const a = (e.getAttribute('aria-label') || e.innerText || '').trim();
    if (!${motif}.test(a)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) continue;
    return JSON.stringify({ a, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
  }
  return JSON.stringify(null);
})()`;

(async () => {
  const d = await main();
  fs.mkdirSync(DOSSIER, { recursive: true });
  await d.call('Browser.setDownloadBehavior',
    { behavior: 'allow', downloadPath: DOSSIER.replace(/\//g, '\\'), eventsEnabled: true });

  let v = JSON.parse(await d.js(VIGNETTES));
  if (!v.length) { console.log('aucune video dans la galerie (galerie ouverte ?)'); d.close(); return; }
  v = v.slice(0, N);
  console.log(`${v.length} video(s) : ${v.map(x => x.t).join(', ')} -> ${DOSSIER}`);

  const faits = [];
  for (const cible of v) {
    const avant = fs.readdirSync(DOSSIER);

    await d.click(cible.x, cible.y);        // ouvre la visionneuse
    await d.wait(2500);

    const dl = JSON.parse(await d.js(BOUTON('/^(save as|download|telecharger|enregistrer)/i')));
    if (!dl) {
      faits.push({ duree: cible.t, erreur: 'bouton Download introuvable' });
    } else {
      await d.click(dl.x, dl.y);
      let nouveau = null;
      for (let k = 0; k < 60 && !nouveau; k++) {
        await d.wait(500);
        nouveau = fs.readdirSync(DOSSIER).find(f => !avant.includes(f) && !f.endsWith('.crdownload'));
      }
      faits.push({ duree: cible.t, fichier: nouveau, ok: !!nouveau });
    }

    const fermer = JSON.parse(await d.js(BOUTON('/^(close|fermer)$/i')));
    if (fermer) await d.click(fermer.x, fermer.y);
    await d.wait(1200);
  }

  console.log(JSON.stringify(faits, null, 2));
  d.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
