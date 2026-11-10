// Assemblage : dépôts → services → routes, en-têtes de sécurité et traduction des erreurs en réponses.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Config } from './config.js';
import { ouvrirBase, type Base } from './depots/base.js';
import { DepotAcces } from './depots/depot-acces.js';
import { DepotTaches } from './depots/depot-taches.js';
import { ErreurMetier, type CodeErreur } from './domaine/erreurs.js';
import { routesApi } from './routes/routes-api.js';
import { routesMcp } from './routes/routes-mcp.js';
import { OutilsMcp } from './services/outils-mcp.js';
import { ServiceAcces } from './services/service-acces.js';
import { ServiceTaches } from './services/service-taches.js';

const STATUTS: Record<CodeErreur, ContentfulStatusCode> = {
  validation: 400,
  non_connecte: 401,
  origine_refusee: 403,
  introuvable: 404,
  conflit: 409,
  trop_gros: 413,
};

const SECURITE: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Ignoré par les navigateurs en HTTP (développement) ; en HTTPS, impose HTTPS pendant un an.
  'Strict-Transport-Security': 'max-age=31536000',
};

const DOSSIER_PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Les seuls fichiers statiques servis, lus une fois : aucun chemin ne vient de la requête. */
const STATIQUES: Record<string, { fichier: string; type: string }> = {
  '/': { fichier: 'index.html', type: 'text/html; charset=utf-8' },
  '/statique/app.js': { fichier: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/statique/cles.js': { fichier: 'cles.js', type: 'text/javascript; charset=utf-8' },
  '/statique/style.css': { fichier: 'style.css', type: 'text/css; charset=utf-8' },
  '/statique/icone.svg': { fichier: 'icone.svg', type: 'image/svg+xml' },
};

export interface Application {
  app: Hono;
  base: Base;
  acces: ServiceAcces;
  taches: ServiceTaches;
}

export function creerApplication(config: Config, options: { cheminBase?: string; maintenant?: () => number } = {}): Application {
  const maintenant = options.maintenant ?? Date.now;
  const base = ouvrirBase(options.cheminBase ?? path.join(config.dossierDonnees, 'taches.db'));
  const acces = new ServiceAcces(new DepotAcces(base), maintenant, config.origine);
  const taches = new ServiceTaches(base, new DepotTaches(base), maintenant);

  const app = new Hono();
  app.use('*', async (c, suite) => {
    await suite();
    for (const [nom, valeur] of Object.entries(SECURITE)) c.res.headers.set(nom, valeur);
  });

  for (const [route, { fichier, type }] of Object.entries(STATIQUES)) {
    const contenu = readFileSync(path.join(DOSSIER_PUBLIC, fichier), 'utf8');
    app.get(route, (c) => c.body(contenu, 200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }));
  }
  app.route('/api', routesApi(acces, taches, config));
  app.route('/mcp', routesMcp(acces, new OutilsMcp(taches), config));

  app.notFound((c) => c.json({ erreur: 'Introuvable.' }, 404));
  app.onError((erreur, c) => {
    if (erreur instanceof ErreurMetier) return c.json({ erreur: erreur.message }, STATUTS[erreur.code]);
    console.error(erreur);
    return c.json({ erreur: 'Erreur du serveur.' }, 500);
  });

  return { app, base, acces, taches };
}
