// Prazos publicados no calendário do Moodle (testes, entregas, fechos) para as cadeiras escolhidas.
import { callWs } from './moodle.mjs';
import { classifyEvent, upsertDeadline } from './deadlines.mjs';

const now = () => Math.floor(Date.now() / 1000);
export const CALENDAR_FUNCTION = 'core_calendar_get_action_events_by_course_by_timesort';

export async function syncCalendar(db, { userId, token, course, silent }) {
  const result = await callWs(token, CALENDAR_FUNCTION, { courseid: String(course.moodle_id), timesortfrom: String(now() - 86400), limitnum: '50' });
  let count = 0;
  for (const event of result?.events || []) {
    if (!['due', 'close', 'gradingdue', 'open'].includes(event.eventtype)) continue;
    // "open" só interessa para testes; entregas só quando fecham.
    if (event.eventtype === 'open') continue;
    const kind = classifyEvent(event.name, event.modulename);
    const dueAt = Number(event.timesort || event.timestart);
    if (!kind || !dueAt || dueAt < now() - 86400) continue;
    const cmid = Number(/[?&]id=(\d+)/.exec(event.url || event.action?.url || '')?.[1]) || 1_000_000_000 + Number(event.id);
    // O prazo de entrega já criado pelo conteúdo da cadeira é substituído pelo tipo mais preciso.
    const previous = kind === 'entrega' ? null : db.prepare("SELECT id,first_seen_at,notified_at,reminded_stage FROM deadlines WHERE course_id=? AND moodle_module_id=? AND due_at=? AND kind='entrega' AND source='moodle'")
      .get(course.id, cmid, dueAt);
    const rowId = upsertDeadline(db, { userId, courseId: course.id, moduleId: cmid, kind, title: String(event.name).slice(0, 160), dueAt, source: 'moodle', silent });
    if (previous) {
      db.prepare('UPDATE deadlines SET first_seen_at=?,notified_at=?,reminded_stage=? WHERE id=?').run(previous.first_seen_at, previous.notified_at, previous.reminded_stage, rowId);
      db.prepare('DELETE FROM deadlines WHERE id=?').run(previous.id);
    }
    count++;
  }
  return count;
}
