#!/usr/bin/env node
// wa.js - pilote l'app WhatsApp Windows (client officiel) via son port de debogage WebView2.
// Aucun appareil lie supplementaire, aucun protocole non officiel : zero risque de ban.
// Prerequis : WhatsApp lance par wa-start.ps1 (ouvre le port 9222).

const PORT = process.env.WA_PORT || 9222;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function page() {
  const list = await (await fetch(`${ORIGIN}/json/list`)).json();
  const t = list.find(x => x.type === 'page' && x.url.includes('web.whatsapp.com'));
  if (!t) throw new Error("page WhatsApp introuvable : lancer wa-start.ps1 d'abord");
  return t.webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = e => rej(new Error('WebSocket: ' + (e.message || 'echec')));
  });
}

let _id = 0;
function send(ws, method, params = {}) {
  const id = ++_id;
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout ' + method)), 30000);
    const on = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      clearTimeout(to); ws.removeEventListener('message', on);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, fn, ...args) {
  const expr = `(${fn.toString()}).apply(null, ${JSON.stringify(args)})`;
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erreur JS');
  return r.result.value;
}

/* ---------- fonctions injectees dans la page ---------- */

const F = {
  chats: (limit) => {
    const pane = document.querySelector('#pane-side');
    if (!pane) return { error: 'liste des chats non chargee' };
    const rows = [...pane.querySelectorAll('div[role="row"]')];
    return rows.slice(0, limit).map(r => {
      const name = r.querySelector('span[title]')?.getAttribute('title') || '';
      const txt = r.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const unread = r.querySelector('span[aria-label*="non lu"], span[aria-label*="unread"]')?.innerText || '';
      return { name, time: txt[1] || '', preview: txt.slice(2).join(' ').slice(0, 160), unread };
    }).filter(c => c.name);
  },

  open: (name) => {
    const pane = document.querySelector('#pane-side');
    if (!pane) return { ok: false, error: 'liste non chargee' };
    const rows = [...pane.querySelectorAll('div[role="row"]')];
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hit = rows.find(r => norm(r.querySelector('span[title]')?.getAttribute('title') || '').includes(norm(name)));
    if (!hit) {
      return { ok: false, error: 'conversation absente de la liste visible',
               vus: rows.map(r => r.querySelector('span[title]')?.getAttribute('title')).filter(Boolean) };
    }
    const target = hit.querySelector('span[title]') || hit;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
    return { ok: true, name: hit.querySelector('span[title]')?.getAttribute('title') };
  },

  expand: async () => {
    const main = document.querySelector('#main');
    if (!main) return { ok: false, error: 'aucune conversation ouverte' };
    const mots = ['read more', 'lire la suite', 'voir plus'];
    let n = 0;
    for (let passe = 0; passe < 6; passe++) {
      const btns = [...main.querySelectorAll('div[role="button"], span[role="button"], button')]
        .filter(b => mots.some(m => (b.innerText || '').trim().toLowerCase() === m));
      if (!btns.length) break;
      for (const b of btns) { b.click(); n++; }
      await new Promise(r => setTimeout(r, 400));
    }
    return { ok: true, deplies: n };
  },

  read: (limit, ME) => {
    const main = document.querySelector('#main');
    if (!main) return { error: 'aucune conversation ouverte' };
    const header = (main.querySelector('header')?.innerText || '').split('\n')[0] || '';
    const rows = [...main.querySelectorAll('div[role="row"]')];
    const out = [];
    for (const r of rows) {
      const cp = r.querySelector('[data-pre-plain-text]');
      const meta = cp?.getAttribute('data-pre-plain-text') || '';
      const m = meta.match(/^\[(.*?),\s*(.*?)\]\s*(.*?):\s*$/);
      // L'app Windows n'a plus la classe .message-out : on se fie aussi a l'auteur (WA_ME, defaut "Yanis").
      const sortant = !!r.querySelector('.message-out, [data-icon="tail-out"]') || (!!m && m[3] === ME);
      const bubble = r.querySelector('.message-in, .message-out') || r;
      let texte = cp ? cp.innerText : bubble.innerText;
      texte = (texte || '').replace(/‎/g, '').trim();
      if (!texte) continue;
      out.push({ heure: m ? m[1] : '', date: m ? m[2] : '', auteur: m ? m[3] : (sortant ? 'moi' : ''), sortant, texte });
    }
    return { conversation: header, total_affiche: out.length, messages: out.slice(-limit) };
  },

  scroll: async (tours) => {
    const cands = [...document.querySelectorAll('#main div')].filter(d => d.scrollHeight > d.clientHeight + 200);
    const box = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!box) return { ok: false, error: 'zone de messages introuvable' };
    for (let i = 0; i < tours; i++) { box.scrollTop = 0; await new Promise(r => setTimeout(r, 1000)); }
    return { ok: true, tours };
  },

  // place le curseur dans la zone de saisie et selectionne tout l'existant,
  // pour que Input.insertText (vraie frappe, cote protocole) le remplace.
  focusComposer: () => {
    const box = document.querySelector('#main footer div[contenteditable="true"]');
    if (!box) return { ok: false, error: 'zone de saisie introuvable (conversation ouverte ?)' };
    box.focus();
    const r = document.createRange();
    r.selectNodeContents(box);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return { ok: true, avant: box.innerText };
  },

  // --- messages vocaux -------------------------------------------------
  // ATTENTION : recuperer un vocal passe par le bouton Play, donc l'expediteur
  // voit le micro bleu ("ecoute"). Pas d'autre chemin : WhatsApp ne cree le blob
  // audio qu'a la lecture, et le menu contextuel n'expose pas de telechargement.
  pttList: () => {
    const main = document.querySelector('#main');
    if (!main) return { error: 'aucune conversation ouverte' };
    const rows = [...main.querySelectorAll('div[role="row"]')];
    const out = [];
    rows.forEach((r, idx) => {
      if (!r.querySelector('span[data-icon="ptt-status"]')) return;
      const txt = r.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      out.push({
        i: idx,
        duree: txt.find(t => /^[0-9]+:[0-9][0-9]$/.test(t)) || '',
        heure: txt[txt.length - 1] || '',
        sortant: !!r.querySelector('.message-out'),
      });
    });
    return out;
  },

  pttGrab: async (idx) => {
    const main = document.querySelector('#main');
    const row = [...main.querySelectorAll('div[role="row"]')][idx];
    if (!row) return { ok: false, error: 'ligne ' + idx + ' absente' };
    // ne PAS matcher /play/i : "Change playback speed" contient "play".
    const play = [...row.querySelectorAll('button,[role="button"]')]
      .find(b => /^(play|pause) voice|message vocal/i.test(b.getAttribute('aria-label') || ''));
    if (!play) return { ok: false, error: 'bouton Play introuvable' };

    play.click();
    let a = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 250));
      a = row.querySelector('audio') || main.querySelector('audio');
      if (a && a.src && a.src.startsWith('blob:')) break;
      a = null;
    }
    if (!a) return { ok: false, error: 'pas de flux audio apres 15 s' };

    const src = a.src, duree = a.duration;
    try { a.pause(); a.currentTime = 0; } catch (e) {}

    const buf = await (await fetch(src)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return { ok: true, octets: bytes.length, secondes: duree, b64: btoa(bin) };
  },

  composer: () => {
    const box = document.querySelector('#main footer div[contenteditable="true"]');
    return box ? box.innerText.replace(/\n$/, '') : null;
  },

  // Une ligne = un <p> dans la zone de saisie (innerText double les sauts, ne pas s'y fier).
  composerLines: () => {
    const box = document.querySelector('#main footer div[contenteditable="true"]');
    return box ? box.querySelectorAll('p').length : 0;
  },

  clearComposer: () => {
    const box = document.querySelector('#main footer div[contenteditable="true"]');
    if (!box) return { ok: false, error: 'zone de saisie introuvable' };
    box.focus();
    return { ok: true };
  },

  sendNow: () => {
    const box = document.querySelector('#main footer div[contenteditable="true"]');
    if (!box) return { ok: false, error: 'zone de saisie introuvable' };
    const texte = box.innerText;
    if (!texte.trim()) return { ok: false, error: 'brouillon vide, rien a envoyer' };
    const icon = document.querySelector('#main footer span[data-icon="send"], #main footer span[data-icon="wds-ic-send-filled"]');
    const btn = icon ? icon.closest('button') : document.querySelector('#main footer button[aria-label*="Envoyer"], #main footer button[aria-label*="Send"]');
    if (btn) { btn.click(); return { ok: true, envoye: texte }; }
    box.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    return { ok: true, envoye: texte, via: 'Entree' };
  },
};

/* ---------- CLI ---------- */

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');

(async () => {
  const ws = await connect(await page());
  await send(ws, 'Runtime.enable');
  let out;
  switch (cmd) {
    case 'chats':  out = await evaluate(ws, F.chats, parseInt(arg) || 20); break;
    case 'open':   out = await evaluate(ws, F.open, arg); break;
    case 'expand': out = await evaluate(ws, F.expand); break;
    case 'read':   await evaluate(ws, F.expand); out = await evaluate(ws, F.read, parseInt(arg) || 30, process.env.WA_ME || "Yanis"); break;
    case 'scroll': out = await evaluate(ws, F.scroll, parseInt(arg) || 3); break;
    case 'draft': {
      const f = await evaluate(ws, F.focusComposer);
      if (!f.ok) { out = f; break; }
      // Texte multi-ligne : `draft --file msg.txt` (ou "\n" dans l'argument).
      let texte = rest[0] === '--file'
        ? (await import('node:fs')).readFileSync(rest[1], 'utf8')
        : arg.replace(/\\n/g, '\n');
      texte = texte.replace(/\r/g, '').replace(/\n+$/, '');
      // "1. " declenche la liste auto de WhatsApp, qui renumerote la ligne suivante ("2. 2.").
      const lignes = texte.split('\n').map(l => l.replace(/^(\s*\d+)\. /, '$1) '));
      const shiftEntree = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 };
      for (let i = 0; i < lignes.length; i++) {
        if (lignes[i]) await send(ws, 'Input.insertText', { text: lignes[i] });
        if (i < lignes.length - 1) {
          await send(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...shiftEntree });
          await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', ...shiftEntree });
        }
      }
      await new Promise(r => setTimeout(r, 300));
      const nbLignes = await evaluate(ws, F.composerLines);
      out = { ok: nbLignes === lignes.length, lignes_attendues: lignes.length, lignes_zone: nbLignes,
              avant: f.avant.replace(/\n$/, ''), brouillon: await evaluate(ws, F.composer) };
      if (!out.ok) out.error = 'nombre de lignes different : verifier le brouillon avant tout envoi';
      break;
    }
    case 'clear': {
      // Vide la zone de saisie (Ctrl+A puis Retour arriere). N'envoie rien.
      const c = await evaluate(ws, F.clearComposer);
      if (!c.ok) { out = c; break; }
      for (const k of [{ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 },
                       { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }]) {
        await send(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
        await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
      }
      await new Promise(r => setTimeout(r, 300));
      const reste = await evaluate(ws, F.composer);
      out = { ok: !reste || !reste.trim(), reste };
      break;
    }
    case 'send': {
      if (process.env.WA_GO !== 'oui') { out = { refus: 'envoi bloque : WA_GO=oui requis (go explicite de Yanis, a chaque envoi)' }; break; }
      const avant = await evaluate(ws, F.composer);
      if (!avant || !avant.trim()) { out = { ok: false, error: 'brouillon vide, rien a envoyer' }; break; }
      out = await evaluate(ws, F.sendNow);
      break;
    }
    case 'vocaux': out = await evaluate(ws, F.pttList); break;
    case 'grab': {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const [idxArg, ...dirArg] = rest;
      const dir = dirArg.join(' ') || '.';
      fs.mkdirSync(dir, { recursive: true });
      const liste = await evaluate(ws, F.pttList);
      const cibles = idxArg && idxArg !== 'tous' ? [{ i: parseInt(idxArg) }] : liste;
      const faits = [];
      for (const c of cibles) {
        const r = await evaluate(ws, F.pttGrab, c.i);
        if (!r.ok) { faits.push({ i: c.i, erreur: r.error }); continue; }
        const f = path.join(dir, `vocal-${String(c.i).padStart(3, '0')}.ogg`);
        fs.writeFileSync(f, Buffer.from(r.b64, 'base64'));
        faits.push({ i: c.i, fichier: f, octets: r.octets, secondes: Math.round(r.secondes || 0), duree: c.duree, heure: c.heure });
      }
      out = faits; break;
    }
    case 'shot': {
      const r = await send(ws, 'Page.captureScreenshot', { format: 'png' });
      const fs = await import('node:fs');
      const p = arg || 'wa.png';
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      out = { fichier: p, octets: fs.statSync(p).size }; break;
    }
    default:
      out = { usage: ['chats [n]', 'open <nom>', 'read [n]', 'scroll [tours]', 'draft <texte>', 'send (WA_GO=oui)', 'shot [fichier.png]'] };
  }
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
