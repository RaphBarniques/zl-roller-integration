import { allowedPackages, config } from '../preflight.ts';
import {
	checkProcessedEvent,
	getSyncedItem,
	saveProcessedEvent,
	saveSyncedItem,
} from '../utils/db.ts';
import { customLog } from '../logger.ts';
import { createZLSession, deleteZLSession } from '../zlAPI.ts';
import { getCustomerEmail } from '../rollerAPI.ts';
import { sendEmail } from '../sendMail.ts'

export async function handleUpdatedWebhook(payload: any) {
	const eventId = payload.id;
	const eventType = String(payload.eventType);
	const booking = payload.data.booking;
	const bookingReference = booking.bookingReference;

	// Check if the event has already been processed
	if (await checkProcessedEvent(eventId)) {
		customLog(
			`Event ${eventId} has been skipped because it has already been processed.`,
			'WARN',
		);
		return;
	}
	// Save the event as processed
	await saveProcessedEvent(eventId, eventType, bookingReference);

	// Checker le paiment et continuer seulement si le paiment est complété
	if (booking.status !== 'Paid') {
		customLog(
			`Booking ${bookingReference} has been skipped because it is not fully paid`,
			'WARN',
		);
		return;
	}

	// Loop through remaining items and process each booking if they are in the allowedPackages list
	const bookingItems = booking.items;
	for (const item of bookingItems) {
		let logMessage = `Processing item ${item.bookingItemId} for booking ${bookingReference}...\n`;
		const packageConfig = allowedPackages.get(item.productId);
        if (!packageConfig) {
			logMessage += `Item ${item.bookingItemId} with package ${item.productId} is not in the allowed packages list. Skipping this item.`;
			await saveSyncedItem(booking, item, {}, null, null, null, "Skipped");
            customLog(logMessage, 'WARN');
			continue;
		}

		const packageName = packageConfig.package_name;
		const zlPackageId = packageConfig.zl_id;
        const isoDate = new Date(`${item.bookingDate} ${item.sessionStartTime}`).toISOString()
        const price = Math.round((item.cost * item.quantity - item.discount) * 100) / 100;
        const isPriceTooLow = item.discount / item.quantity > item.cost / 2;

		// Vérifier si le booking existe déjà dans la base de données (Create or update)
		const dbItem = await getSyncedItem(
			bookingReference,
			item.bookingItemId,
		);
		if (dbItem) {
			logMessage += `Found existing synced item for booking ${bookingReference} and item ${item.bookingItemId}. Updating the record and ZL session if necessary...\n`;

			// Si le booking existe déjà, vérifier si les détails ont changé (ex: nombre de joueurs, date, etc.) et mettre à jour la session ZL en conséquence
			if (
				dbItem.players !== item.quantity ||
				dbItem.start_time !== isoDate ||
				dbItem.roller_package_id !== item.roller_id
			) {
				await deleteZLSession(dbItem.zl_booking_id, booking.roller_booking_id);
				const created = await createZLSession(
					item.bookingItemId,
					booking.bookingReference,
					dbItem.email,
					zlPackageId,
					isoDate,
					item.quantity,
					price,
				);
                if (created) {
                    logMessage += `Updated ZL session for booking ${bookingReference} and item ${item.bookingItemId} due to changes in booking details.\n`;
                } else {
                    logMessage += `Unable to create ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
                    customLog(logMessage, "ERROR")
                    logMessage="";
                    sendEmail("raph.barniques@gmail.com", 2, {bookingReference : bookingReference, startDate : item.bookingDate, startTime: item.sessionStartTime, email: dbItem.email, packageName: packageName, quantity: item.quantity });
                }
				

				// Update the record in the database with the new details
				await saveSyncedItem(booking, item, packageConfig, dbItem.email, isoDate, price, "Matched");
				logMessage += `Updated synced item for booking ${bookingReference} and item ${item.bookingItemId}.\n`;

                if (isPriceTooLow) {
                    logMessage += `Discount too high detected. Sending an email alert to justify the session in portal.`
                    sendEmail("raph.barniques@gmail.com", 1, {bookingReference : bookingReference, startDate : item.bookingDate, startTime: item.sessionStartTime})
                }
                customLog(logMessage, 'INFO');
			} else {
                await saveSyncedItem(booking, item, packageConfig, dbItem.email, isoDate, price, "Skipped");
				logMessage += `No changes detected for booking ${bookingReference} and item ${item.bookingItemId}. No update needed for ZL session.\n`;
                customLog(logMessage, 'INFO');
			}
		} else {
			logMessage += `No existing synced item found for booking ${bookingReference} and item ${item.bookingItemId}. Creating new record and ZL session...\n`;
			const email : string = await getCustomerEmail(booking.customerId);

			const created = await createZLSession(
				item.bookingItemId,
				booking.bookingReference,
				email,
				zlPackageId,
				booking.startDate,
				item.quantity,
				price,
			);

            if (created) {
                    logMessage += `Created ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
                } else {
                    logMessage += `Unable to create ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
                    customLog(logMessage, "ERROR")
                    logMessage="";
                    sendEmail("raph.barniques@gmail.com", 2, {bookingReference : bookingReference, startDate : item.bookingDate, startTime: item.sessionStartTime, email: email, packageName: packageName, quantity: item.quantity });
                }

            // Save into DB
			await saveSyncedItem(booking, item, packageConfig, email, isoDate, price, "Matched");
            logMessage += `Created synced item for booking ${bookingReference} and item ${item.bookingItemId}.`
            
            if (isPriceTooLow) {
                    logMessage += `\nDiscount too high detected. Sending an email alert to justify the session in portal.`
                    sendEmail("raph.barniques@gmail.com", 1, {bookingReference : bookingReference, startDate : item.bookingDate, startTime: item.sessionStartTime})
                }
            customLog(logMessage, "INFO")
		}
	}
}
