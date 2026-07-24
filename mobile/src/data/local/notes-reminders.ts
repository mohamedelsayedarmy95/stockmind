import { getDb, query } from '@/db/database';
import { newId, now } from '@/db/util';
import { scheduleReminder, cancelReminder } from '@/lib/local-notifications';
import { logActivity } from './local-repositories';

/**
 * Notes and reminders are on-device concepts regardless of operationMode
 * (there is no server-side equivalent — a reminder is a local OS
 * notification), so unlike the Warehouse/Product/Stock data these are NOT
 * routed through the online/offline repository-provider seam. They always
 * read/write the local encrypted SQLite DB.
 */

export interface Note {
  id: string;
  productId: string;
  body: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  productId: string | null;
  title: string;
  body: string | null;
  remindAt: string;
  isDone: boolean;
}

interface NoteRow {
  id: string;
  product_id: string;
  body: string;
  created_at: number;
}
interface ReminderRow {
  id: string;
  product_id: string | null;
  title: string;
  body: string | null;
  remind_at: number;
  notification_id: string | null;
  is_done: number;
}

function toNote(r: NoteRow): Note {
  return { id: r.id, productId: r.product_id, body: r.body, createdAt: new Date(r.created_at).toISOString() };
}
function toReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    productId: r.product_id,
    title: r.title,
    body: r.body,
    remindAt: new Date(r.remind_at).toISOString(),
    isDone: r.is_done === 1,
  };
}

export async function listNotes(productId: string): Promise<Note[]> {
  const rows = await query<NoteRow>(
    `SELECT id, product_id, body, created_at FROM notes
     WHERE product_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [productId],
  );
  return rows.map(toNote);
}

export async function createNote(productId: string, body: string): Promise<Note> {
  const id = newId();
  const ts = now();
  await getDb().execute(
    `INSERT INTO notes (id, product_id, body, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [id, productId, body, ts, ts],
  );
  await logActivity('create', 'note', id, body);
  return { id, productId, body, createdAt: new Date(ts).toISOString() };
}

export async function listReminders(productId: string): Promise<Reminder[]> {
  const rows = await query<ReminderRow>(
    `SELECT id, product_id, title, body, remind_at, notification_id, is_done
     FROM reminders WHERE product_id = ? AND deleted_at IS NULL ORDER BY remind_at ASC`,
    [productId],
  );
  return rows.map(toReminder);
}

export async function createReminder(input: {
  productId: string;
  title: string;
  body?: string | null;
  remindAt: Date;
}): Promise<Reminder> {
  const notificationId = await scheduleReminder(input.title, input.body ?? '', input.remindAt);
  const id = newId();
  const ts = now();
  await getDb().execute(
    `INSERT INTO reminders (id, product_id, title, body, remind_at, notification_id, is_done, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending')`,
    [id, input.productId, input.title, input.body ?? null, input.remindAt.getTime(), notificationId, ts, ts],
  );
  await logActivity('create', 'reminder', id, input.title);
  return {
    id,
    productId: input.productId,
    title: input.title,
    body: input.body ?? null,
    remindAt: input.remindAt.toISOString(),
    isDone: false,
  };
}

export async function completeReminder(id: string): Promise<void> {
  const rows = await query<{ notification_id: string | null }>(
    `SELECT notification_id FROM reminders WHERE id = ? LIMIT 1`,
    [id],
  );
  const notificationId = rows[0]?.notification_id;
  if (notificationId) await cancelReminder(notificationId);
  await getDb().execute(
    `UPDATE reminders SET is_done = 1, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
    [now(), id],
  );
}
