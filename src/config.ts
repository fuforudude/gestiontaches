// Configuration lue une fois au démarrage, depuis l'environnement ; une valeur invalide arrête le serveur.
import path from 'node:path';

export interface Config {
  port: number;
  /** Contient taches.db. */
  dossierDonnees: string;
  /** Adresse publique du site, sans barre finale : seule origine acceptée pour les actions du site. */
  origine: string;
  /** Développement en HTTP seulement : le cookie de session perd l'attribut Secure. */
  cookieSecurise: boolean;
}

export function lireConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env.PORT ?? '3200');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalide.');

  const dossier = env.DOSSIER_DONNEES;
  if (!dossier) throw new Error('DOSSIER_DONNEES manquant.');

  const origine = env.ORIGINE;
  if (!origine) throw new Error('ORIGINE manquante.');
  const url = new URL(origine);
  if (url.origin !== origine) throw new Error(`ORIGINE doit être une origine seule, par exemple ${url.origin}.`);

  return {
    port,
    dossierDonnees: path.resolve(dossier),
    origine,
    cookieSecurise: env.COOKIE_NON_SECURISE !== '1',
  };
}
