// Shared audit-trail helpers for platform administration.

export const AUDIT_SELECT = `
  SELECT al.id, al.action, al.old_values, al.new_values, al.created_at,
         al.target_store_id, al.target_user_id,
         actor.name AS actor_name, actor.email AS actor_email,
         st.name AS store_name, target.name AS target_user_name, target.email AS target_user_email
  FROM platform_audit_logs al
  LEFT JOIN users actor ON actor.id = al.actor_user_id
  LEFT JOIN stores st ON st.id = al.target_store_id
  LEFT JOIN users target ON target.id = al.target_user_id`;

export function auditEntry(row) {
  return {
    id: Number(row.id),
    action: row.action,
    old_values: row.old_values || null,
    new_values: row.new_values || null,
    created_at: row.created_at,
    store_id: row.target_store_id,
    store_name: row.store_name || null,
    target_user_name: row.target_user_name || null,
    target_user_email: row.target_user_email || null,
    actor_name: row.actor_name || null,
    actor_email: row.actor_email || null,
  };
}

export async function writeAudit(runner, req, { storeId = null, userId = null, action, oldValues = null, newValues = null }) {
  const result = await runner.query(
    `INSERT INTO platform_audit_logs
       (actor_user_id, target_store_id, target_user_id, action, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, action, old_values, new_values, created_at, target_store_id, target_user_id`,
    [
      req.user.id,
      storeId,
      userId,
      action,
      oldValues == null ? null : JSON.stringify(oldValues),
      newValues == null ? null : JSON.stringify(newValues),
    ]
  );
  return result.rows[0] || null;
}
