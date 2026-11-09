// API du site, sous /api. Toute action qui modifie exige la même origine ; tout sauf la connexion exige une session.
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from '../config.js';
import { ErreurMetier } from '../domaine/erreurs.js';
import type { ServiceAcces } from '../services/service-acces.js';
import type { ServiceTaches } from '../services/service-taches.js';
import { idDepuis, lireJson } from './utilitaires.js';

const COOKIE = 'session';
/** Tâches faites montrées par projet sur le site : les plus récentes. */
const FAITES_MAX = 50;

export function routesApi(acces: ServiceAcces, taches: ServiceTaches, config: Config): Hono {
  const api = new Hono();

  api.use('*', async (c: Context, suite) => {
    c.header('Cache-Control', 'no-store');
    const methode = c.req.method;
    if (methode !== 'GET' && methode !== 'HEAD' && c.req.header('origin') !== config.origine) {
      throw new ErreurMetier('origine_refusee', 'Origine refusée.');
    }
    const libre = (methode === 'POST' && c.req.path === '/api/connexion') || (methode === 'GET' && c.req.path === '/api/session');
    if (!libre && !acces.sessionValide(getCookie(c, COOKIE))) throw new ErreurMetier('non_connecte', 'Connexion requise.');
    await suite();
  });

  api.on(
    ['POST', 'PATCH'],
    '*',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: () => {
        throw new ErreurMetier('trop_gros', 'Requête trop grosse.');
      },
    }),
  );

  api.get('/session', (c) => c.json({ connecte: acces.sessionValide(getCookie(c, COOKIE)) }));

  api.post('/connexion', async (c) => {
    const corps = await lireJson(c);
    const ip = c.req.header('x-real-ip') ?? 'inconnue';
    const { jeton, expireLe } = await acces.connecter(corps.identifiant, corps.motDePasse, ip);
    setCookie(c, COOKIE, jeton, { path: '/', httpOnly: true, secure: config.cookieSecurise, sameSite: 'Strict', expires: new Date(expireLe) });
    return c.json({ connecte: true });
  });

  api.post('/deconnexion', (c) => {
    acces.deconnecter(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: '/', secure: config.cookieSecurise });
    return c.json({ connecte: false });
  });

  /** Tout ce que la page affiche, en une requête (relue régulièrement pour voir ce que Claude a changé). */
  api.get('/etat', (c) => c.json({ projets: taches.projets(), taches: taches.taches({ faitesMax: FAITES_MAX }) }));

  api.post('/projets', async (c) => {
    const corps = await lireJson(c);
    return c.json(taches.creerProjet(corps.nom), 201);
  });
  api.patch('/projets/:id', async (c) => {
    const corps = await lireJson(c);
    return c.json(taches.renommerProjet(idDepuis(c.req.param('id')), corps.nom));
  });
  api.delete('/projets/:id', (c) => {
    taches.supprimerProjet(idDepuis(c.req.param('id')));
    return c.body(null, 204);
  });

  api.post('/taches', async (c) => {
    const corps = await lireJson(c);
    return c.json(taches.creerTache({ projet: corps.projet, titre: corps.titre, details: corps.details, statut: corps.statut }, 'site'), 201);
  });
  api.patch('/taches/:id', async (c) => {
    const corps = await lireJson(c);
    const tache = taches.modifierTache(idDepuis(c.req.param('id')), {
      projet: corps.projet,
      titre: corps.titre,
      details: corps.details,
      statut: corps.statut,
    });
    return c.json(tache);
  });
  api.delete('/taches/:id', (c) => {
    taches.supprimerTache(idDepuis(c.req.param('id')));
    return c.body(null, 204);
  });

  return api;
}
