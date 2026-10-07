#!/usr/bin/env node
// js.js - evalue une expression JS dans la page WhatsApp et affiche le resultat ou l'erreur.
// Usage : node js.js "document.title"   |   node js.js --file script.js
const PORT = process.env.WA_PORT || 9222;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find(x => x.type === 'page' && x.url.includes('web.whatsapp.com'));
  if (!t) throw new Error('page WhatsApp introuvable (lancer wa-start.ps1)');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));

  const args = process.argv.slice(2);
  let expr;
  if (args[0] === '--file') {
    const fs = await import('node:fs');
    expr = fs.readFileSync(args[1], 'utf8');
  } else {
    expr = args.join(' ');
  }

  const id = 1;
  const result = await new Promise((res, rej) => {
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    });
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true },
    }));
  });

  if (result.exceptionDetails) {
    console.error('EXCEPTION JS: ' + (result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)));
    process.exit(1);
  }
  const v = result.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  ws.close();
})().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
