// Crée un lien d'inscription à usage unique (15 minutes) pour enregistrer la clé d'accès d'un appareil.
// À lancer sur le serveur : sudo taches-cle
// Sert à la première clé, puis de secours si tous les appareils sont perdus.
import path from 'node:path';
import { lireConfig } from '../config.js';
import { ouvrirBase } from '../depots/base.js';
import { DepotAcces } from '../depots/depot-acces.js';
import { ServiceAcces } from '../services/service-acces.js';

const config = lireConfig(process.env);
const base = ouvrirBase(path.join(config.dossierDonnees, 'taches.db'));
try {
  const lien = new ServiceAcces(new DepotAcces(base), Date.now, config.origine).creerLienInscription();
  console.log('Lien valable 15 minutes, une seule fois. Ouvre-le sur l\'appareil à enregistrer :');
  console.log(lien);
} finally {
  base.close();
}
