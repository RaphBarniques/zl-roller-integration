 export async function handleUpdatedWebhook(payload: any) {
  // Todo : Éviter dédoublement d'une requête d'un webhook en traitement
  // Todo : Vérifier si le booking existe déjà dans la base de données (Create or update)
  // Todo : Checker le paiment et continuer seulement si le paiment est complété
  // Todo : Séparer et ne garder que le ou les items ZLVR. Itérer si plusieurs items (sessions) dans le même booking
  // Todo : Trouver une facon de ne pas recréer une session qui as été bookée manuellement du côté de ZL
  // Todo : Si le prix est à 0 (peut-être faire le calcul plus précis?), envoyer une alerte email pour remplir l'ecplicatif du booking manuellement
  // Todo : Ajouter ou updater la DB
  // Todo : Booker ou supprimer et booker la session ZL
}