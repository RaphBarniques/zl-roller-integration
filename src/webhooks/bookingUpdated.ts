import { checkProcessedEvent, saveProcessedEvent, getSyncedItem, saveSyncedItem } from "../db.ts";
import { config, allowedPackages } from "../preflight.ts";
import { customLog } from "../logger.ts";
import { createZLSession, deleteZLSession } from "../zlAPI.ts";

export async function handleUpdatedWebhook(payload: any) {
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

  // Checker le paiment et continuer seulement si le paiment est complété
  if (booking.paymentStatus !== "paid") {
    customLog(`Booking ${bookingReference} has been skipped because it is not fully paid`, "WARN");
    return;
  }

  //Loop through remaining items and process each booking if they are in the allowedPackages list
  const bookingItems = booking.items;
  for (const item of bookingItems) {
    let logMessage = `Processing item ${item.roller_id} for booking ${bookingReference}...\n`;
    const packageConfig = allowedPackages.get(item.roller_id);
    if (!packageConfig) {
      logMessage += `Item ${item.roller_id} is not in the allowed packages list. Skipping this item.`;
      customLog(logMessage, "WARN");
      continue;
    }

    const packageName = packageConfig.package_name;
    const rollerItemId = item.roller_id;
    const zlPackageId = packageConfig.zl_id;

    // Vérifier si le booking existe déjà dans la base de données (Create or update)
    const existingItem = await getSyncedItem(booking.roller_booking_id, item.roller_id);
    if (existingItem) {
      logMessage += `Found existing synced item for booking ${bookingReference} and item ${item.roller_id}. Updating the record and ZL session if necessary...\n`;
        
      // Si le booking existe déjà, vérifier si les détails ont changé (ex: nombre de joueurs, date, etc.) et mettre à jour la session ZL en conséquence
        if (existingItem.players !== item.quantity || existingItem.start_time !== booking.startDate || existingItem.roller_package_id !== item.roller_id) {
            // Todo: Delete and recreate the ZL session with the updated details
            // Todo: Update the record in the database with the new details
        } else {
            logMessage += `No changes detected for booking ${bookingReference} and item ${item.roller_id}. No update needed for ZL session.\n`;
        }
    } else {
      logMessage += `No existing synced item found for booking ${bookingReference} and item ${item.roller_id}. Creating new record and ZL session...\n`;
      
      // Todo: Create a new session in ZL
      // Todo: Save the new synced item in the database
    }
  }
  
  // Todo : Trouver une facon de ne pas recréer une session qui as été bookée manuellement du côté de ZL
  // Todo : Si le prix est à + de 50% de rabais, envoyer une alerte email pour remplir l'ecplicatif du booking manuellement
}