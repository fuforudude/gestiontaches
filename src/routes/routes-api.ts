// API du site, sous /api. Toute action qui modifie exige la même origine ; tout sauf la connexion exige une session.
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from '../config.js';
import { ErreurMetier } from '../domaine/erreurs.js';
import type { ServiceAcces, Session } from '../services/service-acces.js';
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
    // Ouverts sans session : la connexion, et l'inscription d'une clé (qui exige alors un lien valide, vérifié par le service).
    const libre =
      (methode === 'GET' && c.req.path === '/api/session') ||
      (methode === 'POST' && ['/api/connexion', '/api/connexion/options', '/api/cles', '/api/cles/options'].includes(c.req.path));
    if (!libre && !acces.sessionValide(getCookie(c, COOKIE))) throw new ErreurMetier('non_connecte', 'Connexion requise.');
    await suite();
  });

  const poserCookie = (c: Context, session: Session) => {
    setCookie(c, COOKIE, session.jeton, {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecurise,
      sameSite: 'Strict',
      expires: new Date(session.expireLe),
    });
  };
  const sessionOuverte = (c: Context) => acces.sessionValide(getCookie(c, COOKIE));

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

  // Connexion par clé d'accès : options (défi), puis réponse signée par l'appareil.
  api.post('/connexion/options', async (c) => c.json(await acces.optionsConnexion()));
  api.post('/connexion', async (c) => {
    const corps = await lireJson(c);
    poserCookie(c, await acces.connecter(corps.reponse));
    return c.json({ connecte: true });
  });

  // Clés d'accès : inscription (session ouverte ou lien à usage unique), liste, retrait, lien pour un autre appareil.
  api.post('/cles/options', async (c) => {
    const corps = await lireJson(c);
    return c.json(await acces.optionsInscription(sessionOuverte(c), corps.lien));
  });
  api.post('/cles', async (c) => {
    const corps = await lireJson(c);
    const { session, cle } = await acces.inscrire(sessionOuverte(c), { lien: corps.lien, nom: corps.nom, reponse: corps.reponse });
    if (session) poserCookie(c, session);
    return c.json(cle, 201);
  });
  api.get('/cles', (c) => c.json(acces.cles()));
  api.delete('/cles/:id', (c) => {
    acces.supprimerCle(c.req.param('id'));
    return c.body(null, 204);
  });
  api.post('/cles/lien', (c) => c.json({ lien: acces.creerLienInscription() }, 201));

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
