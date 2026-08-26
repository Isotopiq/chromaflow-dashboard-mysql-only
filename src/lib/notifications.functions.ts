import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin, type Db } from "@/db/index.server";

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function mapNotification(r: any): Notification {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    readAt: r.read_at ?? null,
    createdAt: String(r.created_at),
  };
}

// ---- List notifications for the current user ----
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, db } = context as {
      userId: string; email: string; isAdmin: boolean; db: Db;
    };
    const rows = await db.many<any>(
      `select * from public.notifications
        where user_id = $1
        order by created_at desc
        limit 50`,
      [userId],
    );
    return rows.map(mapNotification);
  });

// ---- Unread count ----
export const getUnreadCount = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, db } = context as {
      userId: string; email: string; isAdmin: boolean; db: Db;
    };
    const row = await db.maybe<{ count: string }>(
      `select count(*)::text as count from public.notifications
        where user_id = $1 and read_at is null`,
      [userId],
    );
    return { count: Number(row?.count ?? 0) };
  });

// ---- Mark single notification as read ----
export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as {
      userId: string; email: string; isAdmin: boolean; db: Db;
    };
    await db.query(
      "update public.notifications set read_at = now() where id = $1 and user_id = $2",
      [data.id, userId],
    );
    return { ok: true };
  });

// ---- Mark all as read ----
export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, db } = context as {
      userId: string; email: string; isAdmin: boolean; db: Db;
    };
    await db.query(
      "update public.notifications set read_at = now() where user_id = $1 and read_at is null",
      [userId],
    );
    return { ok: true };
  });

// ---- Internal helper: create a notification (admin context) ----
// Called from other server fns when events happen.
export async function notify(
  db: Db,
  userId: string,
  kind: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  try {
    await db.query(
      "select public.create_notification($1, $2, $3, $4, $5)",
      [userId, kind, title, body, link],
    );
  } catch {
    // Notifications are best-effort — never fail the main operation.
  }
}

// ---- Admin: notify all users ----
export const broadcastNotification = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      kind: z.enum(["system"]).default("system"),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).default(""),
      link: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { isAdmin } = context as {
      userId: string; email: string; isAdmin: boolean; db: Db;
    };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    await withAdmin(async (db) => {
      const users = await db.many<{ id: string }>(
        "select id from public.app_users",
      );
      for (const u of users) {
        await db.query(
          "select public.create_notification($1, $2, $3, $4, $5)",
          [u.id, data.kind, data.title, data.body, data.link ?? null],
        );
      }
    });
    return { ok: true, notified: true };
  });
