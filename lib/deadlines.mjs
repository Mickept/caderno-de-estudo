// Prazos (testes, e-fólios, exames, trabalhos) e o estado dos avisos de cada um.
import { id } from './product-security.mjs';

const now = () => Math.floor(Date.now() / 1000);

/** 0 = longe, 1 = menos de 7 dias, 2 = menos de 48 h, 3 = menos de 12 h. */
export const stageFor = (dueAt, at = now()) => {
  const left = Number(dueAt) - at;
  if (left <= 0) return 0;
  return left <= 12 * 3600 ? 3 : left <= 48 * 3600 ? 2 : left <= 7 * 86400 ? 1 : 0;
};
export const STAGE_REASON = { 0: 'novo', 1: 'faltam 7 dias', 2: 'faltam 48 horas', 3: 'é hoje' };

/** Classifica um evento do calendário do Moodle pelo nome e, se for preciso, pelo módulo. */
export function classifyEvent(name, modulename = '') {
  const text = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(exame|prova\s+(de\s+)?avaliacao|avaliacao\s+global|epoca\s+de\s+recurso)\b/.test(text)) return 'exame';
  if (/\b(e-?\s?folio|p-?\s?folio|efolio|pfolio)\b/.test(text)) return 'efolio';
  if (/\b(mini-?\s?teste|teste|quiz|questionario)\b/.test(text) || modulename === 'quiz') return 'teste';
  if (/\b(trabalho|projeto|projecto)\b/.test(text)) return 'trabalho';
  return modulename === 'assign' ? 'entrega' : null;
}

/**
 * Cria ou atualiza um prazo sem perder o estado dos avisos.
 * `silent`: primeira sincronização da cadeira, não avisa de tudo de uma vez.
 */
export function upsertDeadline(db, { userId, courseId, moduleId, kind, title, dueAt, source, note = null, silent = false }) {
  const existing = db.prepare('SELECT id FROM deadlines WHERE course_id=? AND moodle_module_id IS ? AND kind=? AND due_at=?')
    .get(courseId, moduleId, kind, dueAt);
  if (existing) {
    db.prepare('UPDATE deadlines SET title=?,note=? WHERE id=?').run(title, note, existing.id);
    return existing.id;
  }
  const at = now();
  const rowId = id();
  db.prepare(`INSERT INTO deadlines(id,user_id,course_id,moodle_module_id,kind,title,due_at,source,note,first_seen_at,notified_at,reminded_stage)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(rowId, userId, courseId, moduleId, kind, title, dueAt, source, note, at,
    silent ? at : null, silent ? stageFor(dueAt, at) : 0);
  return rowId;
}

/** Avisos por mostrar: prazos novos e prazos que entraram numa fase mais próxima. */
export function pendingAlerts(db, userId, at = now()) {
  const rows = db.prepare(`SELECT d.id,d.course_id,d.title,d.kind,d.due_at,d.source,d.notified_at,d.reminded_stage
    FROM deadlines d JOIN courses c ON c.id=d.course_id
    WHERE d.user_id=? AND c.selected=1 AND d.due_at>? ORDER BY d.due_at`).all(userId, at);
  const alerts = [];
  for (const row of rows) {
    const stage = stageFor(row.due_at, at);
    if (row.notified_at === null) alerts.push({ ...row, stage, reason: 'novo' });
    else if (stage > row.reminded_stage) alerts.push({ ...row, stage, reason: STAGE_REASON[stage] });
  }
  return alerts.map(({ notified_at, reminded_stage, ...alert }) => alert);
}

export function acknowledgeAlerts(db, userId, ids, at = now()) {
  for (const deadlineId of ids) {
    const row = db.prepare('SELECT due_at FROM deadlines WHERE id=? AND user_id=?').get(deadlineId, userId);
    if (row) db.prepare('UPDATE deadlines SET notified_at=COALESCE(notified_at,?),reminded_stage=? WHERE id=?')
      .run(at, stageFor(row.due_at, at), deadlineId);
  }
}
