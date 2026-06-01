import { checkProcessedEvent, saveProcessedEvent, getSyncedItem, saveSyncedItem } from "../db.ts";
import { config, allowedPackages } from "../preflight.ts";
import { customLog } from "../logger.ts";
import { createZLSession, deleteZLSession } from "../zlAPI.ts";

export async function handleDeletedWebhook(payload: any) {
    const eventId = payload.id;
    const eventType = String(payload.eventType);
    const booking = payload.data.booking;
    const bookingReference = booking.bookingReference;

    // Check if the event has already been processed
    if (await checkProcessedEvent(eventId)) {
      customLog(`Event ${eventId} has been skipped because it has already been processed.`, "WARN");
      return;
    }
    // Save the event as processed
    await saveProcessedEvent(eventId, eventType, bookingReference);

    
  // Todo : Update la DB
  // Todo : Supprimer la session ZL
}