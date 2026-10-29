// Leitura do PUC (Plano da Unidade Curricular): procura datas de e-fólios, exames, trabalhos e testes.
// É uma extração por palavras-chave: as datas devem ser sempre confirmadas no PUC.

const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7,
  ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const monthName = '(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\\.?';
const monthOf = (name) => MONTHS[fold(name).replace('.', '')];
const yearPart = '(?:\\s*(?:de|/|,)?\\s*(\\d{4}))?';
const NUMERIC = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})(?!\d)/g;
const RANGE_TEXT = new RegExp(`(\\d{1,2})(?:\\s*(?:de)?\\s*${monthName})?\\s*(?:a|até|ate|-|–|e)\\s*(\\d{1,2})\\s*(?:de)?\\s*${monthName}${yearPart}`, 'gi');
const SINGLE_TEXT = new RegExp(`(\\d{1,2})\\s*(?:de)?\\s*${monthName}${yearPart}`, 'gi');

/** @type {[string, RegExp][]} */
const CATEGORIES = [
  ['exame', /\b(exame|prova\s+(?:de\s+)?(?:avaliacao\s+)?(?:global|final)|avaliacao\s+(?:final|global)|epoca\s+(?:normal|de\s+recurso|especial)|recurso)\b/],
  ['efolio', /\b(e-?\s?f[oó]lios?|efolios?|p-?\s?f[oó]lios?|pfolios?)\b/],
  ['trabalho', /\b(trabalho|projeto|projecto|relatorio|entrega)\b/],
  ['teste', /\b(mini-?\s?teste|teste|quiz|questionario)\b/],
];
export const KIND_LABELS = { exame: 'Exame', efolio: 'e-fólio', trabalho: 'Trabalho', teste: 'Teste' };

export class YearContext {
  constructor() { this.start = null; }
  learn(text) {
    const m = /\b(20\d\d)\s*[/\-]\s*(20)?(\d\d)\b/.exec(text);
    if (m && Number(m[3]) === (Number(m[1]) + 1) % 100) this.start = Number(m[1]);
  }
  infer(month, now = new Date()) {
    const start = this.start ?? (now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1);
    return month >= 9 ? start : start + 1;
  }
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

function datesInLine(line, ctx) {
  const found = [];
  let rest = line;
  const take = (re, build) => {
    rest = rest.replace(re, (...args) => { const r = build(args); if (r) { found.push(r); return ' '.repeat(args[0].length); } return args[0]; });
  };
  take(NUMERIC, ([, d, m, y]) => valid(fullYear(+y), +m, +d) ? { y: fullYear(+y), m: +m, d: +d, approx: false } : null);
  // intervalo numérico já fica como duas datas consecutivas; reduzimos a intervalo mais abaixo
  take(RANGE_TEXT, ([, d1, m1n, d2, m2n, y]) => {
    const m2 = monthOf(m2n), m1 = m1n ? monthOf(m1n) : m2;
    const y2 = y ? +y : ctx.infer(m2), y1 = m1 > m2 && !y ? y2 - 1 : y2;
    if (!valid(y1, m1, +d1) || !valid(y2, m2, +d2) || (y1 === y2 && m1 === m2 && +d1 >= +d2)) return null;
    return { y: y1, m: m1, d: +d1, end: { y: y2, m: m2, d: +d2 }, approx: !y };
  });
  take(SINGLE_TEXT, ([, d, mn, y]) => {
    const m = monthOf(mn); const yy = y ? +y : ctx.infer(m);
    return valid(yy, m, +d) ? { y: yy, m, d: +d, approx: !y } : null;
  });
  found.sort((a, b) => line.indexOf(String(a.d)) - line.indexOf(String(b.d)));
  // junta pares "dd/mm/aaaa a dd/mm/aaaa"
  const joined = [];
  for (let i = 0; i < found.length; i++) {
    const a = found[i], b = found[i + 1];
    if (!a.end && b && !b.end && /\b(a|ate|até|-|–)\b/i.test(line.slice(line.indexOf(String(a.d)), line.lastIndexOf(String(b.d)))) &&
        Date.UTC(b.y, b.m - 1, b.d) > Date.UTC(a.y, a.m - 1, a.d) && /^\d/.test(line.slice(line.indexOf(String(a.d))))) {
      joined.push({ ...a, end: { y: b.y, m: b.m, d: b.d } }); i++;
    } else joined.push(a);
  }
  return joined;
}

const iso = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

/** @returns {{kind:string,title:string,start:string,end:string|null,approx:boolean,global:boolean,snippet:string}[]} */
export function extractEvaluations(text, ctx = new YearContext()) {
  ctx.learn(text);
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const results = [];
  const seen = new Set();
  lines.forEach((line, i) => {
    const dates = datesInLine(line, ctx);
    if (!dates.length) return;
    // contexto: a própria linha; se não tiver palavra-chave, a linha anterior
    for (const source of [line, `${lines[i - 1] || ''} ${line}`]) {
      const plain = fold(source);
      const hit = CATEGORIES.find(([, re]) => re.test(plain));
      if (!hit) continue;
      const kind = hit[0];
      for (const d of dates) {
        const key = `${kind}|${iso(d)}|${d.end ? iso(d.end) : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ kind, title: line.replace(/\s+/g, ' ').slice(0, 140), start: iso(d), end: d.end ? iso(d.end) : null,
          approx: d.approx, global: kind === 'exame' && /\b(global|final)\b/.test(plain), snippet: source.slice(0, 220) });
      }
      break;
    }
  });
  return results;
}

/** Instante (segundos) em que acaba o prazo: fim do dia do último dia, hora de Lisboa aproximada por UTC 23:59. */
export const dueTimestamp = (ev) => {
  const p = (ev.end || ev.start).split('-').map(Number);
  return Math.floor(Date.UTC(p[0], p[1] - 1, p[2], 23, 59, 0) / 1000);
};

export const looksLikePuc = (name, text = '') =>
  /\bpuc\b|plano\s+da\s+unidade\s+curricular/i.test(name) || /plano\s+da\s+unidade\s+curricular/i.test(String(text).slice(0, 600));
