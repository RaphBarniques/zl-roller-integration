import { db } from '../preflight.ts';

type Booking = {
	roller_booking_id: string;
	roller_item_id: string;
	zl_booking_id: string;
	payment_status: string;
	sync_status: string;
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

export async function getSyncedItem(
	rollerBookingId: string,
	rollerItemId: string,
) {
	return db
		.query(
			`
        SELECT *
        FROM synced_items
        WHERE roller_booking_id = ?
        AND roller_item_id = ?
        `,
		)
		.get(rollerBookingId, rollerItemId) as Booking | null;
}

export async function saveSyncedItem(booking: any, bookingItem: any) {
	db.run(
		`
    INSERT OR REPLACE INTO synced_items (
      roller_booking_id,
      roller_item_id,
      zl_booking_id,
      payment_status,
      sync_status,
      email,
      players,
      start_time,
      roller_package_id,
      zl_package_id,
      package_name,
      price
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
		[
			booking.roller_booking_id,
			bookingItem.roller_item_id,
			booking.zl_booking_id,
			booking.payment_status,
			booking.sync_status,
			booking.email,
			booking.players,
			booking.start_time,
			booking.roller_package_id,
			booking.zl_package_id,
			booking.package_name,
			booking.price,
		],
	);
}
