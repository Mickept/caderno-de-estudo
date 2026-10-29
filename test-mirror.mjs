// Espelho numerado + PUC: sincroniza um Moodle falso com subsecções, página, livro, vídeo e PUC em HTML.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'mirror-'));
process.env.PRODUCT_FILES_DIR = join(temp, 'files');
process.env.NODE_ENV = 'test';
process.env.APP_SECRET ||= 'segredo-de-teste-com-tamanho-suficiente-123456';
const token = 'tok123';
const html = (s) => Buffer.from(`<html><body>${s}</body></html>`);
const pucHtml = html('<h2>Plano da Unidade Curricular 2026/2027</h2><h3>9. Avaliação</h3><p>e-fólio A: de 10 a 17 de novembro</p><p>Prova de avaliação global: 28 de janeiro de 2027</p>');
let calendarEvents = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/webservice/pluginfile.php/')) {
    if (url.searchParams.get('token') !== token) { res.statusCode = 403; return res.end(); }
    const name = decodeURIComponent(url.pathname.split('/').pop());
    res.setHeader('content-type', name.endsWith('.html') ? 'text/html' : name.endsWith('.mp4') ? 'video/mp4' : 'image/png');
    return res.end(name === 'puc.html' ? pucHtml : name === 'index.html' ? html(`<p>Capítulo ${url.pathname}</p><img src="@@PLUGINFILE@@/fig.png"><script>alert(1)</script>`)
      : name === 'aula.mp4' ? Buffer.alloc(2048, 1) : Buffer.from('png'));
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const params = new URLSearchParams(Buffer.concat(chunks).toString());
  res.setHeader('content-type', 'application/json');
  const f = (n) => `${base}/webservice/pluginfile.php/1/${n}`;
  if (params.get('wsfunction') === 'core_webservice_get_site_info')
    return res.end(JSON.stringify({ userid: 1, functions: ['core_webservice_get_site_info', 'core_enrol_get_users_courses', 'core_course_get_contents', 'core_calendar_get_action_events_by_course_by_timesort'].map((name) => ({ name })) }));
  if (params.get('wsfunction') === 'core_calendar_get_action_events_by_course_by_timesort') return res.end(JSON.stringify({ events: calendarEvents }));
  res.end(JSON.stringify([
    { id: 1, section: 0, name: 'Apresentação', modules: [{ id: 10, modname: 'page', name: 'Plano da Unidade Curricular (PUC)', contents: [{ type: 'file', filename: 'puc.html', fileurl: f('puc.html'), timemodified: 5 }] }] },
    { id: 2, section: 1, name: 'Tema 1 - Introdução', modules: [{ id: 20, modname: 'subsection', instance: 9, name: 'Recursos' }, { id: 21, modname: 'resource', name: 'Aula', contents: [{ type: 'file', filename: 'aula.mp4', fileurl: f('aula.mp4'), timemodified: 7 }] }] },
    { id: 3, section: 2, name: 'Recursos', component: 'mod_subsection', itemid: 9, modules: [{ id: 30, modname: 'book', name: 'Livro', contents: [
      { type: 'file', filename: 'structure', content: JSON.stringify([{ title: 'Intro', href: '5/index.html', level: 0, subitems: [] }]) },
      { type: 'file', filename: 'index.html', filepath: '/5/', fileurl: f('index.html'), timemodified: 9 },
      { type: 'file', filename: 'fig.png', filepath: '/5/', fileurl: f('fig.png'), timemodified: 9 }] }] }]));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.MOODLE_URL = base;
try {
  const { openProductDb } = await import('./lib/product-db.mjs');
  const { syncUser } = await import('./lib/product-sync.mjs');
  const { encryptToken } = await import('./lib/product-security.mjs');
  const db = openProductDb(':memory:');
  db.prepare("INSERT INTO users VALUES('u','a@b.c','x',1)").run();
  db.prepare("INSERT INTO moodle_connections VALUES('u',?,1,'T','[]',1,NULL)").run(encryptToken(token));
  db.prepare("INSERT INTO courses(id,user_id,moodle_id,name,shortname,selected,source) VALUES('c1','u',7,'Cadeira','C',1,'moodle')").run();
  const result = await syncUser(db, 'u');
  assert.equal(result.warning, null);
  const files = db.prepare('SELECT filename,item_number,section_path,mime,path FROM files ORDER BY item_number').all();
  assert.deepEqual(files.map((x) => [x.item_number, x.section_path]),
    [['0.1', '0 - Apresentação'], ['1.1.1', '1 - Tema 1 - Introdução/1.1 - Recursos'], ['1.2', '1 - Tema 1 - Introdução']]);
  assert.ok(files.every((x) => existsSync(x.path)));
  assert.ok(files[1].path.includes('/1 - Tema 1 - Introdução/1.1 - Recursos/'), 'pastas reais no disco');
  const book = readFileSync(files[1].path, 'utf8');
  assert.ok(book.includes('data:image/png;base64') && !book.includes('<script'), 'imagens embebidas e sem scripts');
  const dl = db.prepare("SELECT kind,source,note,due_at FROM deadlines WHERE source='puc' ORDER BY due_at").all();
  assert.deepEqual(dl.map((d) => d.kind), ['efolio', 'exame']);
  assert.ok(dl[0].note.includes('Confirma no PUC'));
  const soon = Math.floor(Date.now() / 1000) + 5 * 86400;
  const { pendingAlerts, acknowledgeAlerts, stageFor } = await import('./lib/deadlines.mjs');
  assert.equal(pendingAlerts(db, 'u').length, 0, 'primeira sincronização não inunda de avisos');
  calendarEvents = [
    { id: 1, name: 'Mini-teste 1', modulename: 'quiz', eventtype: 'close', timesort: soon, url: `${base}/mod/quiz/view.php?id=77` },
    { id: 2, name: 'e-fólio A', modulename: 'assign', eventtype: 'due', timesort: soon + 86400, url: `${base}/mod/assign/view.php?id=78` },
    { id: 3, name: 'Abertura do teste', modulename: 'quiz', eventtype: 'open', timesort: soon, url: `${base}/mod/quiz/view.php?id=77` }];
  await syncUser(db, 'u'); // idempotente
  const alerts = pendingAlerts(db, 'u');
  assert.deepEqual(alerts.filter((a) => a.reason === 'novo').map((a) => a.kind).sort(), ['efolio', 'teste']);
  acknowledgeAlerts(db, 'u', alerts.map((a) => a.id));
  assert.equal(pendingAlerts(db, 'u').length, 0, 'depois de dispensados não voltam a aparecer');
  await syncUser(db, 'u');
  assert.equal(pendingAlerts(db, 'u').length, 0, 'nova sincronização não repete avisos');
  const first = db.prepare("SELECT id,due_at FROM deadlines WHERE kind='teste'").get();
  db.prepare('UPDATE deadlines SET due_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) + 3600, first.id);
  assert.equal(stageFor(Math.floor(Date.now() / 1000) + 3600), 3);
  assert.equal(pendingAlerts(db, 'u')[0].reason, 'é hoje', 'lembrete quando o prazo se aproxima');
  assert.equal(db.prepare('SELECT count(*) n FROM files').get().n, 3);
  assert.equal(db.prepare("SELECT count(*) n FROM deadlines WHERE source='puc'").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM deadlines WHERE kind='teste'").get().n, 1, 'evento "open" ignorado');
  console.log('test-mirror ok');
} finally { server.close(); }
