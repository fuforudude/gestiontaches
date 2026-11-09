// Crée le jeton du serveur MCP (et révoque le précédent), puis affiche l'adresse à donner à Claude. À lancer sur le serveur :
//   sudo taches-jeton
// L'adresse contient le jeton : elle ne s'affiche qu'une fois, à copier directement dans le connecteur.
import path from 'node:path';
import { lireConfig } from '../config.js';
import { ouvrirBase } from '../depots/base.js';
import { DepotAcces } from '../depots/depot-acces.js';
import { ServiceAcces } from '../services/service-acces.js';

const config = lireConfig(process.env);
const base = ouvrirBase(path.join(config.dossierDonnees, 'taches.db'));
try {
  const jeton = new ServiceAcces(new DepotAcces(base), Date.now).nouveauJetonMcp();
  console.log('Nouveau jeton créé ; l\'ancien ne marche plus.');
  console.log(`Adresse du serveur MCP : ${config.origine}/mcp/${jeton}`);
} finally {
  base.close();
}
