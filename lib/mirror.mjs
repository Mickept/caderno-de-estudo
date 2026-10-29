// Espelho da estrutura do Moodle: numeração 1 / 1.1 / 1.1.1, como na página da cadeira.
// Moodle 4.5 devolve subsecções (mod_subsection) como secções separadas, ligadas por itemid.

export const cleanName = (value, max = 70) => {
  let part = String(value || '').replace(/<[^>]*>/g, ' ').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '').trim().slice(0, max).trim();
  if (!part || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) part = `item-${part || 'sem-nome'}`;
  return part;
};
const withoutNumber = (name, number) => String(name || '').replace(new RegExp(`^\\s*${number.replace(/\./g, '\\.')}[\\s.:\\-–]+`), '').trim();
const label = (number, name) => cleanName(`${number} - ${withoutNumber(name, number) || name}`);

/**
 * @returns {{module:object, number:string, folder:string[]}[]} um item por atividade, por ordem do Moodle.
 */
export function planMirror(/** @type {any[]} */ sections = []) {
  const delegated = new Map();
  for (const section of sections)
    if (section.component === 'mod_subsection' && section.itemid != null) delegated.set(Number(section.itemid), section);
  const items = [];
  const walk = (section, prefix, folder, depth) => {
    let counter = 0;
    for (const module of section.modules || []) {
      counter++;
      const number = `${prefix}.${counter}`;
      const child = module.modname === 'subsection' ? delegated.get(Number(module.instance)) : null;
      if (child && depth < 4) walk(child, number, [...folder, label(number, module.name || child.name)], depth + 1);
      else if (module.modname !== 'subsection') items.push({ module, number, folder });
    }
  };
  for (const section of sections) {
    if (section.component === 'mod_subsection') continue;
    const n = String(section.section ?? items.length);
    walk(section, n, [label(n, section.name || `Tema ${n}`)], 1);
  }
  return items;
}

const decodeEntities = (text) => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
export const htmlToText = (html) => decodeEntities(String(html)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|h[1-6]|li|tr|br)>|<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bodyOf = (html) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

/** Documento HTML autónomo (sem scripts); imagens passadas em `images` {nome: dataUri} ficam embebidas. */
export function standaloneHtml(title, bodyHtml, images = {}) {
  let body = bodyOf(bodyHtml).replace(/<(script|iframe|object|embed|link)[\s\S]*?(<\/\1>|\/>|>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  body = body.replace(/(<img[^>]*?\ssrc=)(["'])([^"']*)\2/gi, (all, head, quote, src) => {
    const name = decodeURIComponent(src.split('?')[0].split('/').pop() || '');
    return images[name] ? `${head}"${images[name]}"` : all;
  });
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:50rem;margin:2rem auto;padding:0 1rem}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #888;padding:.3rem .5rem}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export const imageMime = (name) => imageTypes[String(name).toLowerCase().match(/\.[a-z0-9]+$/)?.[0]] || null;

/** Capítulos de um mod_book a partir de module.contents (index.html em filepath /{id}/ e `structure`). */
export function bookChapters(/** @type {any} */ module) {
  const contents = module.contents || [];
  let structure = [];
  try { structure = JSON.parse(contents.find((c) => c.filename === 'structure')?.content || '[]'); } catch { /* ignora */ }
  const titles = new Map();
  const flatten = (list, level = 1) => list.forEach((chapter) => {
    titles.set(String(chapter.href || '').replace(/\/index\.html$/, '').replace(/^\/|\/$/g, ''), { title: chapter.title, level, number: chapter.level });
    flatten(chapter.subitems || [], level + 1);
  });
  flatten(structure);
  const chapters = contents.filter((c) => c.filename === 'index.html' && c.type === 'file').map((c) => {
    const key = String(c.filepath || '').replace(/^\/|\/$/g, '');
    return { key, file: c, title: titles.get(key)?.title || `Capítulo ${key}`, level: titles.get(key)?.level || 1 };
  });
  return { chapters, images: contents.filter((c) => c.type === 'file' && imageMime(c.filename)) };
}

export const mediaExtension = /\.(mp4|m4v|webm|mov|mp3|m4a|ogg|wav)$/i;
