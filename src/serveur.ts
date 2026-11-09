// Point d'entrée : écoute sur 127.0.0.1 seulement, nginx est le seul à parler au serveur.
import { serve } from '@hono/node-server';
import { creerApplication } from './app.js';
import { lireConfig } from './config.js';

const config = lireConfig(process.env);
const { app, base } = creerApplication(config);

const serveur = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Tâches : http://127.0.0.1:${info.port} (public : ${config.origine})`);
});

const arreter = () => {
  serveur.close(() => {
    base.close();
    process.exit(0);
  });
};
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
