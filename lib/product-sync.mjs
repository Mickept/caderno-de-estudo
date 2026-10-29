import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { PRODUCT_FILES_DIR } from './product-db.mjs';
import { decryptToken, id } from './product-security.mjs';
import { callWs, getBytes, baseUrl } from './moodle.mjs';
import { extrairTexto } from './extract.mjs';
import { ehListaDePessoas, ehPauta } from './categorize.mjs';
import { planMirror, cleanName, bookChapters, imageMime, htmlToText, standaloneHtml, mediaExtension } from './mirror.mjs';
import { upsertDeadline } from './deadlines.mjs';
import { syncCalendar, CALENDAR_FUNCTION } from './calendar.mjs';
import { extractEvaluations, dueTimestamp, looksLikePuc, YearContext, KIND_LABELS } from './puc.mjs';

const now = () => Math.floor(Date.now() / 1000);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const documentTypes = {
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text', '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint', '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.rtf': 'application/rtf',
  '.epub': 'application/epub+zip', '.zip': 'application/zip', '.html': 'text/html',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const MEDIA_LIMIT = 200 * 1024 * 1024;
const zipFormats = new Set(['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.epub', '.zip']);
const legacyOfficeFormats = new Set(['.doc', '.ppt', '.xls']);
export const supportedDocument = (filename) => Object.hasOwn(documentTypes, extname(String(filename)).toLowerCase());
const safePart = (value) => {
  let part = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80);
  if (!part || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) part = `material-${part || 'sem-nome'}`;
  return part;
};
export const REQUIRED_FUNCTIONS = ['core_webservice_get_site_info', 'core_enrol_get_users_courses', 'core_course_get_contents'];

export function assertFunctions(site, names = REQUIRED_FUNCTIONS) {
  const available = new Set((site.functions || []).map((f) => f.name));
  const missing = names.filter((name) => !available.has(name));
  if (missing.length) throw new Error(`O Moodle não autorizou as funções necessárias (${missing.join(', ')}). Podes continuar com PDFs enviados manualmente.`);
  return available;
}

export function assertMoodleFileUrl(fileurl) {
  const url = new URL(fileurl);
  const root = new URL(baseUrl());
  const localTest = process.env.NODE_ENV !== 'production' && root.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(root.hostname);
  if (!(url.protocol === 'https:' || (localTest && url.protocol === 'http:')) || url.origin !== root.origin ||
      !url.pathname.startsWith(`${root.pathname.replace(/\/$/, '')}/webservice/pluginfile.php`))
    throw new Error('O Moodle devolveu um endereço de ficheiro inesperado.');
  return url;
}

export async function storeFile(db, { userId, courseId, moduleId = null, filename, fileurl = null, modified = null, source, bytes, folder = null, itemNumber = null }) {
  const extension = extname(String(filename)).toLowerCase();
  const mime = documentTypes[extension];
  if (!mime) throw new Error('Formato não suportado. Usa PDF, Office, OpenDocument, texto, EPUB ou ZIP.');
  const isMedia = /^(video|audio)\//.test(mime);
  if (bytes.length > (isMedia ? MEDIA_LIMIT : 20 * 1024 * 1024)) throw new Error(isMedia ? 'O vídeo excede 200 MB.' : 'O ficheiro excede 20 MB.');
  if (extension === '.pdf' && (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-'))
    throw new Error('Este ficheiro não é um PDF válido.');
  if (zipFormats.has(extension) && !(bytes[0] === 0x50 && bytes[1] === 0x4b &&
      ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8))))
    throw new Error('Este documento ou arquivo não tem um formato ZIP válido.');
  if (legacyOfficeFormats.has(extension) && !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    throw new Error('Este documento Office antigo não tem um formato válido.');
  const existing = source === 'moodle'
    ? db.prepare('SELECT * FROM files WHERE course_id=? AND moodle_module_id=? AND filename=?').get(courseId, moduleId, filename)
    : null;
  const fileId = existing?.id || id();
  const contentHash = digest(bytes);
  if (existing?.hash === contentHash && existing.path && existing.text_status !== 'falhou') {
    db.prepare('UPDATE files SET moodle_modified=?,fileurl=?,section_path=COALESCE(?,section_path),item_number=COALESCE(?,item_number) WHERE id=?').run(modified, fileurl, folder ? folder.join('/') : null, itemNumber, fileId);
    return { id: fileId, changed: false };
  }
  const course = db.prepare('SELECT name FROM courses WHERE id=? AND user_id=?').get(courseId, userId);
  if (!course) throw new Error('Cadeira não encontrada.');
  const directory = join(PRODUCT_FILES_DIR, userId, `${safePart(course.name)}-${courseId.slice(0, 8)}`, ...(folder || []).map((part) => cleanName(part)));
  const baseName = safePart(filename.slice(0, -extension.length)).slice(0, 70);
  let path = existing?.path;
  if (!path) {
    path = folder ? join(directory, `${itemNumber ? `${itemNumber} - ` : ''}${baseName}${extension}`) : join(directory, `${fileId}-${baseName}${extension}`);
    if (folder && existsSync(path)) path = join(directory, `${itemNumber ? `${itemNumber} - ` : ''}${baseName}-${fileId.slice(0, 6)}${extension}`);
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${id()}.part`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, path);
  let extracted = extension === '.pdf' ? await extrairTexto(bytes, mime, filename) : null;
  if (extension === '.html') {
    const texto = htmlToText(Buffer.from(bytes).toString('utf8'));
    extracted = { status: texto.length < 20 ? 'vazio' : 'ok', texto, paginas: [texto] };
  }
  const safeText = extracted && !(ehPauta(filename) || ehListaDePessoas(extracted.texto)) ? extracted.texto : null;
  const textStatus = extracted ? safeText === null ? 'privado' : extracted.status : 'sem-extracao';
  const pagesJson = extracted && safeText !== null ? JSON.stringify(extracted.paginas || []) : null;
  if (existing) {
    db.prepare(`UPDATE files SET fileurl=?,moodle_modified=?,mime=?,size=?,hash=?,path=?,text=?,text_status=?,pages_json=?,changed_at=?,section_path=?,item_number=? WHERE id=?`)
      .run(fileurl, modified, mime, bytes.length, contentHash, path, safeText, textStatus, pagesJson, now(), folder ? folder.join('/') : existing?.section_path ?? null, itemNumber ?? existing?.item_number ?? null, fileId);
    db.prepare('DELETE FROM analyses WHERE file_id=?').run(fileId);
  } else {
    db.prepare(`INSERT INTO files(id,user_id,course_id,moodle_module_id,filename,fileurl,mime,size,moodle_modified,hash,path,text,text_status,source,pages_json,first_seen_at,changed_at,section_path,item_number)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fileId, userId, courseId, moduleId, filename, fileurl, mime, bytes.length,
        modified, contentHash, path, safeText, textStatus, source, pagesJson, now(), now(), folder ? folder.join('/') : null, itemNumber);
  }
  return { id: fileId, changed: true };
}


const known = (db, courseId, moduleId, filename) =>
  db.prepare('SELECT moodle_modified,path,text_status FROM files WHERE course_id=? AND moodle_module_id=? AND filename=?').get(courseId, moduleId, filename);
const upToDate = (row, modified) => row?.path && row.moodle_modified === modified && row.text_status !== 'falhou';

/** Descarrega uma atividade para a pasta numerada do espelho. Devolve quantos ficheiros novos/alterados. */
async function mirrorModule(db, { userId, token, course, module, number, folder }) {
  const base = { userId, courseId: course.id, moduleId: module.id, source: 'moodle', folder, itemNumber: number };
  const contents = module.contents || [];
  const fetchBytes = async (file, limit) => { assertMoodleFileUrl(file.fileurl); return getBytes(file.fileurl, token, limit, /\.html?$/i.test(file.filename)); };
  let changed = 0;
  if (module.modname === 'page') {
    const index = contents.find((c) => c.type === 'file' && /\.html?$/i.test(c.filename));
    if (!index) return 0;
    const filename = `${cleanName(module.name)}.html`;
    if (upToDate(known(db, course.id, module.id, filename), index.timemodified)) return 0;
    const images = {};
    for (const img of contents.filter((c) => c.type === 'file' && imageMime(c.filename)).slice(0, 40)) {
      try { images[img.filename] = `data:${imageMime(img.filename)};base64,${Buffer.from(await fetchBytes(img)).toString('base64')}`; } catch { /* imagem opcional */ }
    }
    const html = standaloneHtml(module.name, Buffer.from(await fetchBytes(index)).toString('utf8'), images);
    return (await storeFile(db, { ...base, filename, modified: index.timemodified, bytes: Buffer.from(html) })).changed ? 1 : 0;
  }
  if (module.modname === 'book') {
    const { chapters, images: imageFiles } = bookChapters(module);
    if (!chapters.length) return 0;
    const filename = `${cleanName(module.name)}.html`;
    const modified = Math.max(0, ...contents.map((c) => c.timemodified || 0));
    if (upToDate(known(db, course.id, module.id, filename), modified)) return 0;
    const images = {};
    for (const img of imageFiles.slice(0, 60)) {
      try { images[img.filename] = `data:${imageMime(img.filename)};base64,${Buffer.from(await fetchBytes(img)).toString('base64')}`; } catch { /* imagem opcional */ }
    }
    let index = '<nav><h2>Índice</h2><ol>', body = '';
    chapters.forEach((chapter, i) => { index += `<li style="margin-left:${(chapter.level - 1) * 1.2}rem"><a href="#c${i}">${chapter.title.replace(/</g, '&lt;')}</a></li>`; });
    index += '</ol></nav>';
    for (const [i, chapter] of chapters.entries())
      body += `<section id="c${i}"><h2>${chapter.title.replace(/</g, '&lt;')}</h2>${Buffer.from(await fetchBytes(chapter.file)).toString('utf8').replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/gi, '')}</section>`;
    const html = standaloneHtml(module.name, index + body, images);
    return (await storeFile(db, { ...base, filename, modified, bytes: Buffer.from(html) })).changed ? 1 : 0;
  }
  for (const file of contents) {
    if (file.type !== 'file' || !supportedDocument(file.filename || '')) continue;
    if (upToDate(known(db, course.id, module.id, file.filename), file.timemodified)) continue;
    const media = mediaExtension.test(file.filename);
    try {
      const bytes = await fetchBytes(file, media ? MEDIA_LIMIT : undefined);
      const saved = await storeFile(db, { ...base, filename: file.filename, fileurl: file.fileurl, modified: file.timemodified, bytes });
      if (saved.changed) changed++;
    } catch (error) {
      if (error.kind === 'TOKEN_INVALIDO') throw error;
      throw new Error(`${file.filename}: ${error.message}`);
    }
  }
  return changed;
}

/** Procura o PUC entre os materiais da cadeira e cria prazos (source 'puc') a partir das datas encontradas. */
export function updatePucDeadlines(db, userId, courseId, silent = false) {
  const rows = db.prepare(`SELECT id,filename,section_path,moodle_module_id,text FROM files
    WHERE course_id=? AND user_id=? AND source='moodle' AND text IS NOT NULL`).all(courseId, userId);
  const pucs = rows.filter((row) => looksLikePuc(`${row.filename} ${row.section_path || ''}`, row.text));
  const ctx = new YearContext();
  for (const row of pucs) ctx.learn(row.text);
  const wanted = [];
  for (const row of pucs) for (const ev of extractEvaluations(row.text, ctx)) {
    wanted.push({ userId, courseId, moduleId: row.moodle_module_id, kind: ev.kind, dueAt: dueTimestamp(ev), source: 'puc', silent,
      title: `${KIND_LABELS[ev.kind]}${ev.global ? ' (global)' : ''}: ${ev.title.slice(0, 90)}`,
      note: `${ev.end ? `${ev.start} a ${ev.end}. ` : ''}${ev.approx ? 'Ano deduzido do ano letivo. ' : ''}Confirma no PUC: "${ev.snippet}"` });
  }
  // Mantém o estado dos avisos dos prazos que continuam; só apaga os que deixaram de existir.
  const keep = new Set();
  for (const item of wanted) keep.add(upsertDeadline(db, item));
  for (const old of db.prepare("SELECT id FROM deadlines WHERE course_id=? AND user_id=? AND source='puc'").all(courseId, userId))
    if (!keep.has(old.id)) db.prepare('DELETE FROM deadlines WHERE id=?').run(old.id);
  return keep.size;
}

export async function syncUser(db, userId) {
  const connection = db.prepare('SELECT * FROM moodle_connections WHERE user_id=?').get(userId);
  if (!connection) throw new Error('Liga o Moodle para sincronizar. Também podes enviar materiais manualmente.');
  const token = decryptToken(connection.token_enc);
  const runId = id();
  db.prepare("INSERT INTO sync_runs(id,user_id,started_at,status) VALUES(?,?,?,'running')").run(runId, userId, now());
  let count = 0;
  const warnings = [];
  try {
    const site = await callWs(token, 'core_webservice_get_site_info');
    assertFunctions(site);
    const available = new Set((site.functions || []).map((f) => f.name));
    if (site.userid !== connection.moodle_user_id) throw new Error('O token passou a pertencer a outra conta Moodle. Volta a ligar a conta.');
    const courses = db.prepare('SELECT * FROM courses WHERE user_id=? AND selected=1 AND source=?').all(userId, 'moodle');
    for (const course of courses) {
      const silent = course.last_synced_at == null;
      const sections = await callWs(token, 'core_course_get_contents', { courseid: String(course.moodle_id) });
      for (const { module, number, folder } of planMirror(sections)) {
        for (const due of module.dates || []) {
          if (due.dataid !== 'duedate' || !due.timestamp) continue;
          upsertDeadline(db, { userId, courseId: course.id, moduleId: module.id, kind: 'entrega', title: module.name, dueAt: due.timestamp, source: 'moodle', silent });
        }
        try {
          count += await mirrorModule(db, { userId, token, course, module, number, folder });
        } catch (error) {
          if (error.kind === 'TOKEN_INVALIDO') throw error;
          warnings.push(`${module.name}: ${error.message}`);
        }
      }
      if (available.has(CALENDAR_FUNCTION)) {
        try { await syncCalendar(db, { userId, token, course, silent }); }
        catch (error) { if (error.kind === 'TOKEN_INVALIDO') throw error; warnings.push(`Calendário: ${error.message}`); }
      }
      try { updatePucDeadlines(db, userId, course.id, silent); } catch (error) { warnings.push(`PUC: ${error.message}`); }
      db.prepare('UPDATE courses SET last_synced_at=? WHERE id=?').run(now(), course.id);
    }
    const warning = warnings.length ? `${warnings.length} ficheiro(s) não foram descarregados. Podes tentar sincronizar de novo.` : null;
    db.prepare('UPDATE sync_runs SET finished_at=?,status=?,new_count=?,error=? WHERE id=?')
      .run(now(), warning ? 'partial' : 'ok', count, warning, runId);
    db.prepare('UPDATE moodle_connections SET last_error=? WHERE user_id=?').run(warning, userId);
    return { newCount: count, warning };
  } catch (error) {
    const message = error.kind === 'TOKEN_INVALIDO' ? 'A ligação ao Moodle expirou. Volta a ligar a conta.' :
      error.kind === 'SITE_EM_MANUTENCAO' ? 'O Moodle está em manutenção. Tenta novamente mais tarde.' :
      error.message;
    db.prepare("UPDATE sync_runs SET finished_at=?,status='error',error=? WHERE id=?").run(now(), message, runId);
    db.prepare('UPDATE moodle_connections SET last_error=? WHERE user_id=?').run(message, userId);
    throw new Error(message);
  }
}
