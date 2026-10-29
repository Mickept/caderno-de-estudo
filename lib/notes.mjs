// Apontamentos do aluno por cadeira (e resumos por tema, criados à mão ou pela IA).
import { id } from './product-security.mjs';

const now = () => Math.floor(Date.now() / 1000);
export const MAX_NOTE = 60000;

export function saveNote(db, userId, { id: noteId = null, courseId, title, body, sectionPath = null, kind = 'nota' }) {
  const course = db.prepare('SELECT id FROM courses WHERE id=? AND user_id=?').get(courseId, userId);
  if (!course) throw Object.assign(new Error('Cadeira não encontrada.'), { status: 404 });
  const cleanTitle = String(title || '').trim().slice(0, 140) || 'Sem título';
  const cleanBody = String(body ?? '');
  if (cleanBody.length > MAX_NOTE) throw new Error('O apontamento é demasiado grande (máximo 60 000 caracteres).');
  const path = sectionPath ? String(sectionPath).slice(0, 400) : null;
  if (noteId) {
    const result = db.prepare('UPDATE notes SET title=?,body=?,section_path=?,updated_at=? WHERE id=? AND user_id=?')
      .run(cleanTitle, cleanBody, path, now(), noteId, userId);
    if (!result.changes) throw Object.assign(new Error('Apontamento não encontrado.'), { status: 404 });
    return noteId;
  }
  const newId = id();
  db.prepare('INSERT INTO notes(id,user_id,course_id,section_path,title,body,kind,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(newId, userId, courseId, path, cleanTitle, cleanBody, kind === 'resumo' ? 'resumo' : 'nota', now());
  return newId;
}

export const deleteNote = (db, userId, noteId) => db.prepare('DELETE FROM notes WHERE id=? AND user_id=?').run(noteId, userId).changes > 0;

export const listNotes = (db, userId) => db.prepare(
  'SELECT id,course_id,section_path,title,body,kind,updated_at FROM notes WHERE user_id=? ORDER BY updated_at DESC LIMIT 500').all(userId);
