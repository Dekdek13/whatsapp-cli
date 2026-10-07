#!/usr/bin/env node
// ui.js - vraies actions souris/clavier (protocole CDP) sur la page WhatsApp.
// Necessaire quand les evenements synthetiques du DOM ne suffisent pas (survol, menus).
const PORT = process.env.WA_PORT || 9222;

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find(x => x.type === 'page' && x.url.includes('web.whatsapp.com'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0;
  const call = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    const to = setTimeout(() => rej(new Error('timeout ' + method)), 30000);
    const on = e => {
      const m = JSON.parse(e.data);
      if (m.id !== i) return;
      clearTimeout(to); ws.removeEventListener('message', on);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const js = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erreur JS');
    return r.result.value;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const move = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  };
  const click = async (x, y, button = 'left') => {
    await move(x, y);
    await wait(120);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, buttons: button === 'right' ? 2 : 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, buttons: 0 });
  };

  // attend un evenement CDP (ex. Page.fileChooserOpened)
  const once = (method, timeoutMs = 15000) => new Promise((res, rej) => {
    const to = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('timeout evenement ' + method)); }, timeoutMs);
    const on = e => {
      const m = JSON.parse(e.data);
      if (m.method !== method) return;
      clearTimeout(to); ws.removeEventListener('message', on); res(m.params);
    };
    ws.addEventListener('message', on);
  });

  return { call, js, wait, move, click, once, close: () => ws.close() };
}

module.exports = { main };

if (require.main === module) {
  (async () => {
    const d = await main();
    const [cmd, ...a] = process.argv.slice(2);
    if (cmd === 'rect') {
      console.log(JSON.stringify(await d.js(`(()=>{const e=document.querySelector(${JSON.stringify(a.join(' '))});
        if(!e) return null; const r=e.getBoundingClientRect();
        return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), w:Math.round(r.width), h:Math.round(r.height)};})()`)));
    } else if (cmd === 'click') {
      await d.click(parseInt(a[0]), parseInt(a[1]), a[2] || 'left');
      console.log('clic ' + (a[2] || 'left') + ' en ' + a[0] + ',' + a[1]);
    } else if (cmd === 'move') {
      await d.move(parseInt(a[0]), parseInt(a[1]));
      console.log('souris en ' + a[0] + ',' + a[1]);
    }
    d.close();
  })().catch(e => { console.error('ERREUR: ' + e.message); process.exit(1); });
}
