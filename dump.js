#!/usr/bin/env node
// dump.js - exporte des conversations WhatsApp en JSON, pour analyse (ex. le style d'ecriture de Yanis).
// Usage :
//   node dump.js liste <sortie.json>                 toutes les conversations (nom, date, non lus), sans rien ouvrir
//   node dump.js export <liste.json> <dossier> [N]   ouvre chaque conversation SANS non lus, remonte N crans (defaut 12),
//                                                    ecrit <dossier>/<nom>.json ; les conversations avec non lus sont sautees
// ATTENTION : ouvrir une conversation la marque comme lue. Celles qui ont des non lus ne sont jamais ouvertes.
// Ne jamais versionner les exports (conversations privees).

const fs = require('node:fs');
const path = require('node:path');
const PORT = process.env.WA_PORT || 9222;
const ME = process.env.WA_ME || 'Yanis';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find(x => x.type === 'page' && x.url.includes('web.whatsapp.com'));
  if (!t) throw new Error('page WhatsApp introuvable : lancer wa-start.ps1');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id;
    const to = setTimeout(() => rej(new Error('timeout ' + method)), 60000);
    const on = e => {
      const m = JSON.parse(e.data); if (m.id !== my) return;
      clearTimeout(to); ws.removeEventListener('message', on);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const ev = async (fn, ...args) => {
    const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erreur JS');
    return r.result.value;
  };
  return { ws, send, ev };
}

// --- fonctions injectees ---
const visibleRows = () => [...document.querySelectorAll('#pane-side div[role="row"]')].map(r => {
  const name = r.querySelector('span[title]')?.getAttribute('title') || '';
  const txt = r.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const unread = r.querySelector('span[aria-label*="unread"], span[aria-label*="non lu"]')?.innerText || '';
  return { name, time: txt[1] || '', unread };
}).filter(c => c.name);

const scrollPane = (top) => { const p = document.querySelector('#pane-side'); if (top) p.scrollTop = 0; else p.scrollTop += p.clientHeight * 0.8; return p.scrollTop + p.clientHeight >= p.scrollHeight - 5; };

const clickChat = (name) => {
  const rows = [...document.querySelectorAll('#pane-side div[role="row"]')];
  const hit = rows.find(r => r.querySelector('span[title]')?.getAttribute('title') === name);
  if (!hit) return false;
  const t = hit.querySelector('span[title]');
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
  return true;
};

// l'en-tete peut commencer par les initiales de l'avatar ("RG\nRomain C Guidotti") : on garde tout le texte
const header = () => document.querySelector('#main header')?.innerText || '';

// WhatsApp ne garde que ~100 lignes dans le DOM (liste virtualisee) : on lit a chaque cran
// en remontant, et on dedoublonne par data-id. Ordre final : du plus ancien au plus recent.
const harvest = async (tours, ME) => {
  const box = [...document.querySelectorAll('#main div')]
    .filter(d => d.scrollHeight > d.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(d).overflowY))
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  const seen = new Map();
  const grab = () => {
    const batch = [];
    for (const r of document.querySelectorAll('#main div[role="row"]')) {
      const cp = r.querySelector('[data-pre-plain-text]');
      if (!cp) continue; // appels, medias sans texte, separateurs de date
      const id = r.querySelector('[data-id]')?.getAttribute('data-id') || cp.getAttribute('data-pre-plain-text') + cp.innerText.slice(0, 40);
      if (seen.has(id)) continue;
      const m = (cp.getAttribute('data-pre-plain-text') || '').match(/^\[(.*?),\s*(.*?)\]\s*(.*?):\s*$/);
      // les emojis sont des <img alt="😂"> : innerText les perd, on clone en les remplacant par leur alt
      const clone = cp.cloneNode(true);
      clone.querySelectorAll('img[alt]').forEach(i => i.replaceWith(document.createTextNode(i.getAttribute('data-plain-text') || i.alt)));
      document.body.appendChild(clone); clone.style.cssText = 'position:fixed;left:-9999px;white-space:pre-wrap';
      const texte = (clone.innerText || '').replace(/‎/g, '').trim();
      clone.remove();
      if (!texte) continue;
      const auteur = m ? m[3] : '';
      batch.push([id, { date: m ? m[2] : '', heure: m ? m[1] : '', auteur, moi: auteur === ME || !!r.querySelector('[data-icon="tail-out"]'), texte }]);
    }
    // les lignes du haut sont les plus anciennes : on les place devant ce qu'on a deja
    const old = [...seen.entries()];
    seen.clear();
    for (const [k, v] of batch) seen.set(k, v);
    for (const [k, v] of old) seen.set(k, v);
  };
  grab();
  if (box) for (let i = 0; i < tours; i++) { box.scrollTop = 0; await new Promise(r => setTimeout(r, 1500)); grab(); }
  return [...seen.values()];
};

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  const { ws, send, ev } = await connect();

  if (cmd === 'liste') {
    const seen = new Map();
    await ev(scrollPane, true); await sleep(800);
    for (let i = 0; i < 400; i++) {
      for (const r of await ev(visibleRows)) if (!seen.has(r.name)) seen.set(r.name, r);
      const end = await ev(scrollPane, false);
      await sleep(500);
      if (end) { for (const r of await ev(visibleRows)) if (!seen.has(r.name)) seen.set(r.name, r); break; }
    }
    await ev(scrollPane, true);
    fs.writeFileSync(a, JSON.stringify([...seen.values()], null, 1));
    console.log(JSON.stringify({ ok: true, conversations: seen.size, non_lues: [...seen.values()].filter(x => x.unread).map(x => x.name) }));
  } else if (cmd === 'export') {
    const liste = JSON.parse(fs.readFileSync(a, 'utf8'));
    const tours = parseInt(c) || 12;
    fs.mkdirSync(b, { recursive: true });
    const bilan = { exportes: [], sautes_non_lus: [], introuvables: [] };
    for (const conv of liste) {
      if (conv.unread) { bilan.sautes_non_lus.push(conv.name); continue; }
      const fichier = path.join(b, conv.name.replace(/[\\/:*?"<>|]/g, '_') + '.json');
      if (fs.existsSync(fichier)) { bilan.exportes.push(conv.name); continue; }
      // retrouver la ligne : on fait defiler la liste depuis le haut jusqu'a la voir
      await ev(scrollPane, true); await sleep(500);
      let ok = false;
      for (let i = 0; i < 200 && !ok; i++) {
        const vis = await ev(visibleRows);
        const row = vis.find(r => r.name === conv.name);
        if (row) {
          if (row.unread) { bilan.sautes_non_lus.push(conv.name); ok = 'skip'; break; } // non lu arrive entre-temps
          ok = await ev(clickChat, conv.name);
          break;
        }
        if (await ev(scrollPane, false)) break;
        await sleep(300);
      }
      if (ok === 'skip') continue;
      if (!ok) { bilan.introuvables.push(conv.name); continue; }
      await sleep(1500);
      // l'en-tete perd les emojis (rendus en <img>) : comparer lettres et chiffres seulement
      const lettres = s => s.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (!lettres(await ev(header)).includes(lettres(conv.name))) { bilan.introuvables.push(conv.name + ' (en-tete different)'); continue; }
      const msgs = await ev(harvest, tours, ME);
      fs.writeFileSync(fichier, JSON.stringify({ conversation: conv.name, messages: msgs }, null, 1));
      bilan.exportes.push(conv.name);
      process.stderr.write(`${bilan.exportes.length} ${conv.name} : ${msgs.length} messages (${msgs.filter(x => x.moi).length} de moi)\n`);
    }
    await ev(scrollPane, true);
    console.log(JSON.stringify(bilan, null, 1));
  } else {
    console.log('usage : node dump.js liste <sortie.json> | node dump.js export <liste.json> <dossier> [crans]');
  }
  ws.close();
})().catch(e => { console.error(e.message); process.exit(1); });
