export async function handleCreatedWebhook(payload: any) {
  // Todo : Éviter dédoublement d'une requête d'un webhook en traitement
  // Todo : Check for payment status and only create session if payment is completed
  // Todo : Séparer et ne garder que le ou les items ZLVR. Itérer si plusieurs items (sessions) dans le même booking
  // Todo : S'assurer que le booking n'existe pas déjà dans la base de données (devrait pas but you never know)
  // Todo : Trouver une facon de ne pas recréer une session qui as été bookée manuellement du côté de ZL
  // Todo : Si le prix est à 0 (peut-être faire le calcul plus précis?), envoyer une alerte email pour remplir l'ecplicatif du booking manuellement
  // Todo : Ajouter à la DB
  // Todo : Booker la session ZL
}