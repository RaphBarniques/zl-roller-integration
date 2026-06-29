import { db } from '../preflight.ts';

export type Booking = {
	roller_booking_id: string;
	roller_booking_unique_id: string | null;
	roller_item_id: string;
	zl_booking_id: string;
	payment_status: string;
	sync_status: string;
	zl_booked: boolean;
	attraction: string;
	email: string;
	players: number;
	start_time: string;
	roller_package_id: number;
	zl_package_id: number;
	package_name: string;
	price: number;
};

type ProcessedEvent = {
	event_id: string;
	event_type: string;
	booking_reference: string;
	received_at: string;
};

export type WebhookQueueItem = {
	id: number;
	event_id: string;
	event_type: string;
	booking_reference: string | null;
	status: string;
	created_at: string;
	updated_at: string;
	payload: string;
};

export async function checkProcessedEvent(eventId: string) {
	return (
		db
			.query('SELECT event_id FROM processed_events WHERE event_id = ?')
			.get(eventId) !== null
	);
}

export async function getProcessedEvent(eventId: string) {
	return db
		.query('SELECT * FROM processed_events WHERE event_id = ?')
		.get(eventId) as ProcessedEvent | null;
}

export async function saveProcessedEvent(
	eventId: string,
	eventType: string,
	bookingReference: string,
) {
	db.run(
		`
    INSERT INTO processed_events (
      event_id,
      event_type,
      booking_reference
    )
    VALUES (?, ?, ?)
    `,
		[eventId, eventType, bookingReference],
	);
}

export async function enqueueWebhookItem(
	eventId: string,
	eventType: string,
	bookingReference: string | null,
	payload: string,
) {
	db.run(
		`INSERT OR IGNORE INTO webhook_queue (
			event_id, 
			event_type, 
			booking_reference,
			payload
		) VALUES (?, ?, ?, ?)`,
		[eventId, eventType, bookingReference, payload],
	);
}

export async function getQueuedWebhooks() {
	return db
		.query(
			'SELECT id, event_id, event_type, booking_reference, status, created_at, updated_at, payload FROM webhook_queue WHERE status = ? ORDER BY created_at ASC',
		)
		.all('queued') as WebhookQueueItem[];
}

export async function getQueuedWebhook(id: number) {
	return db
		.query('SELECT * FROM webhook_queue WHERE id = ?')
		.get(id) as WebhookQueueItem | null;
}

export async function deleteQueuedWebhook(id: number) {
	db.run('DELETE FROM webhook_queue WHERE id = ?', [id]);
}

export async function updateQueuedWebhookStatus(id: number, status: string) {
	db.run(
		'UPDATE webhook_queue SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
		[status, id],
	);
}

export async function getQueuePaused() {
	const row = db
		.query('SELECT value FROM app_settings WHERE key = ?')
		.get('queue_paused') as { value: string } | null;

	return row?.value === '1';
}

export async function setQueuePaused(paused: boolean) {
	db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
		'queue_paused',
		paused ? '1' : '0',
	]);
}

export async function getWebhookQueueItems() {
	return db
		.query(
			'SELECT id, event_type, booking_reference, status, created_at, updated_at FROM webhook_queue ORDER BY created_at ASC',
		)
		.all() as Array<{
		id: number;
		event_type: string;
		booking_reference: string | null;
		status: string;
		created_at: string;
		updated_at: string;
	}>;
}

export async function deleteWebhookQueueItem(id: number) {
	db.run('DELETE FROM webhook_queue WHERE id = ?', [id]);
}

export async function getQueuedWebhookById(id: number) {
	return getQueuedWebhook(id);
}

export async function getAllWebhookQueueItems() {
	return db
		.query(
			'SELECT id, event_type, booking_reference, status, created_at, updated_at FROM webhook_queue ORDER BY created_at ASC',
		)
		.all();
}

export async function getQueuedWebhookByEventId(eventId: string) {
	return db
		.query('SELECT * FROM webhook_queue WHERE event_id = ?')
		.get(eventId);
}

export async function getSyncedItem(
	rollerBookingId: string,
	rollerItemId: string,
) {
	return db
		.query(`SELECT * 
			FROM synced_items 
			WHERE roller_booking_id = ? 
			AND roller_item_id = ?`)
		.get(rollerBookingId, rollerItemId) as Booking | null;
}

export async function getSyncedItems(bookingReference: string) {
	return db
		.query(
			`
			SELECT *
			FROM synced_items
			WHERE roller_booking_id = ?
				AND sync_status NOT IN ('Cancelled', 'Deleted')
			`,
		)
		.all(bookingReference) as any[];
}

export async function saveSyncedItem(
	booking: any,
	bookingItem: any,
	zlbookingID: any,
	packageConfig: any,
	attraction: any,
	zl_booked: any,
	email: any,
	isoDate: any,
	price: any,
	status: any,
) {
	db.run(
		`
    INSERT OR REPLACE INTO synced_items (
      roller_booking_id,
			roller_booking_unique_id,
      roller_item_id,
      zl_booking_id,
      payment_status,
      sync_status,
	  attraction,
	  zl_booked,
      email,
      players,
      start_time,
      roller_package_id,
      zl_package_id,
      package_name,
      price
    )
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
		[
			booking.bookingReference,
			booking.uniqueId ?? null,
			bookingItem.bookingItemId,
			zlbookingID,
			booking.status,
			status,
			attraction,
			zl_booked,
			email,
			bookingItem.quantity,
			isoDate,
			bookingItem.productId,
			packageConfig.zl_id ?? null,
			packageConfig.package_name ?? null,
			price,
		],
	);
}

export async function updateSyncedItemStatus(
	bookingReference: string,
	rollerItemId: string,
	status: string,
	zl_booked: boolean | string,
) {
	db.run(
		`
        UPDATE synced_items
        SET sync_status = ?,
			zl_booked = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE roller_booking_id = ?
          AND roller_item_id = ?
        `,
		[status, zl_booked, bookingReference, rollerItemId],
	);
}

export async function deleteSyncedItem(
	rollerBookingID: string,
	rollerItemID: string,
) {
	db.run(
		`
    DELETE FROM synced_items
        WHERE roller_booking_id = ?
        AND roller_item_id = ?
    `,
		[rollerBookingID, rollerItemID],
	);
}
