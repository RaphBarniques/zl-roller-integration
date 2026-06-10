import { db } from "./preflight";
import { formatDate, streamLogs } from "./logger";

export async function getLogs(req: Request) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level") || "ALL";

  const date = formatDate(new Date, false)
  const file = Bun.file(`./logs/server-${date}.log`);

  if (!(await file.exists())) {
    return Response.json([]);
  }

  const text = await file.text();

  let lines = text
    .split("\n")
    .filter(Boolean)
    .reverse();

  if (level !== "ALL") {
    lines = lines.filter((line) => line.includes(`(${level})`));
  }

  return Response.json(lines.slice(0, 500));
}

export function getLogsStream(req: Request) {
  return streamLogs();
}

export function getLatestBooking() {
  const row = db
    .query(`
      SELECT *
      FROM synced_items
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get();

  return Response.json(row ?? null);
}

export function searchBookings(req: Request) {
  const url = new URL(req.url);
  const q = `%${url.searchParams.get("q") || ""}%`;
  const status = url.searchParams.get("status") || "ALL";

  let rows:any;

  if (status === "ALL") {
    rows = db
      .query(`
        SELECT *
        FROM synced_items
        WHERE roller_booking_id LIKE ?
           OR roller_item_id LIKE ?
           OR zl_booking_id LIKE ?
           OR sync_status LIKE ?
        ORDER BY updated_at DESC
        LIMIT 100
      `)
      .all(q, q, q, q);
  } else {
    rows = db
      .query(`
        SELECT *
        FROM synced_items
        WHERE sync_status = ?
          AND (
            roller_booking_id LIKE ?
            OR roller_item_id LIKE ?
            OR zl_booking_id LIKE ?
            OR sync_status LIKE ?
          )
        ORDER BY updated_at DESC
        LIMIT 100
      `)
      .all(status, q, q, q, q);
  }

  return Response.json(rows) ?? null;
}