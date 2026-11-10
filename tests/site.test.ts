// Site : page, API des projets et des tâches, garde-fous (la connexion est dans cles.test.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config.js';
import { creerBanc, ORIGINE, type Banc } from './aide.js';

let banc: Banc;
beforeEach(async () => {
  banc = await creerBanc();
});
afterEach(() => {
  banc.fermer();
});

interface Etat {
  projets: { id: number; nom: string; aFaire: number; enCours: number; faites: number }[];
  taches: { id: number; projet: string; titre: string; statut: string; source: string; faiteLe: number | null }[];
}
const lireEtat = async () => (await (await banc.site('GET', '/etat')).json()) as Etat;

describe('page et connexion', () => {
  it('sert la page avec les en-têtes de sécurité', async () => {
    const page = await banc.requete('/');
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Mes tâches/);
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect((await banc.requete('/statique/app.js')).status).toBe(200);
    expect((await banc.requete('/statique/cles.js')).status).toBe(200);
    expect((await banc.requete('/nimporte')).status).toBe(404);
  });

  it('exige une session pour l\'API et la ferme à la déconnexion', async () => {
    expect(await (await banc.site('GET', '/session')).json()).toEqual({ connecte: true });
    expect((await banc.site('POST', '/deconnexion')).status).toBe(200);
    expect((await banc.site('GET', '/etat')).status).toBe(401);
    expect(await (await banc.site('GET', '/session')).json()).toEqual({ connecte: false });
  });

  it('refuse une action venue d\'une autre origine', async () => {
    const reponse = await banc.requete('/api/taches', {
      method: 'POST',
      headers: { origin: 'https://mechant.exemple', cookie: banc.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ projet: 'A', titre: 'x' }),
    });
    expect(reponse.status).toBe(403);
  });
});

describe('tâches et projets', () => {
  it('ajoute, coche, décoche et supprime une tâche', async () => {
    const creee = await banc.site('POST', '/taches', { projet: 'Perso', titre: 'Appeler le garage' });
    expect(creee.status).toBe(201);
    const { id, source } = (await creee.json()) as { id: number; source: string };
    expect(source).toBe('site');

    const cochee = (await (await banc.site('PATCH', `/taches/${id}`, { statut: 'faite' })).json()) as { faiteLe: number | null };
    expect(cochee.faiteLe).toBe(banc.horloge.instant);
    const decochee = (await (await banc.site('PATCH', `/taches/${id}`, { statut: 'a_faire' })).json()) as { faiteLe: number | null };
    expect(decochee.faiteLe).toBeNull();

    expect((await banc.site('DELETE', `/taches/${id}`)).status).toBe(204);
    expect((await banc.site('DELETE', `/taches/${id}`)).status).toBe(404);
    expect((await banc.site('PATCH', '/taches/abc', { statut: 'faite' })).status).toBe(404);
  });

  it('voit les tâches créées par Claude, avec les compteurs par projet', async () => {
    await banc.outil('creer_tache', { projet: 'Multiplay', titre: 'Corriger le classement', statut: 'en_cours' });
    await banc.site('POST', '/taches', { projet: 'multiplay', titre: 'Relire la spec' });
    const etat = await lireEtat();
    expect(etat.projets).toMatchObject([{ nom: 'Multiplay', aFaire: 1, enCours: 1, faites: 0 }]);
    expect(etat.taches.map((t) => [t.titre, t.source])).toEqual([
      ['Corriger le classement', 'claude'],
      ['Relire la spec', 'site'],
    ]);
  });

  it('crée, renomme et supprime un projet avec ses tâches', async () => {
    const { id } = (await (await banc.site('POST', '/projets', { nom: 'Études' })).json()) as { id: number };
    expect((await banc.site('POST', '/projets', { nom: 'études' })).status).toBe(409);
    await banc.site('POST', '/taches', { projet: 'Études', titre: 'Réviser' });
    await banc.site('POST', '/projets', { nom: 'Perso' });

    expect((await banc.site('PATCH', `/projets/${id}`, { nom: 'Perso' })).status).toBe(409);
    expect(await (await banc.site('PATCH', `/projets/${id}`, { nom: 'Fac' })).json()).toMatchObject({ nom: 'Fac', aFaire: 1 });
    expect((await banc.site('PATCH', '/projets/999', { nom: 'Rien' })).status).toBe(404);

    expect((await banc.site('DELETE', `/projets/${id}`)).status).toBe(204);
    expect((await banc.site('DELETE', `/projets/${id}`)).status).toBe(404);
    const etat = await lireEtat();
    expect(etat.projets.map((p) => p.nom)).toEqual(['Perso']);
    expect(etat.taches).toEqual([]);
  });

  it('valide les saisies', async () => {
    expect((await banc.site('POST', '/taches', { projet: 'A' })).status).toBe(400);
    expect((await banc.site('POST', '/taches', { projet: 'A', titre: 'x', details: 42 })).status).toBe(400);
    expect((await banc.site('POST', '/taches', { projet: 'A', titre: 'x', details: 'd'.repeat(4001) })).status).toBe(400);
    expect((await banc.site('POST', '/projets', { nom: 'p'.repeat(81) })).status).toBe(400);
    const pasJson = await banc.requete('/api/projets', {
      method: 'POST',
      headers: { origin: ORIGINE, cookie: banc.cookie, 'content-type': 'application/json' },
      body: '[1]',
    });
    expect(pasJson.status).toBe(400);
  });
});

describe('configuration', () => {
  it('lit et contrôle l\'environnement', () => {
    expect(lireConfig({ DOSSIER_DONNEES: '/d', ORIGINE: 'https://a.fr' })).toMatchObject({ port: 3200, cookieSecurise: true });
    expect(lireConfig({ DOSSIER_DONNEES: '/d', ORIGINE: 'http://localhost:3200', COOKIE_NON_SECURISE: '1' }).cookieSecurise).toBe(false);
    expect(() => lireConfig({ ORIGINE: 'https://a.fr' })).toThrow(/DOSSIER_DONNEES/);
    expect(() => lireConfig({ DOSSIER_DONNEES: '/d' })).toThrow(/ORIGINE/);
    expect(() => lireConfig({ DOSSIER_DONNEES: '/d', ORIGINE: 'https://a.fr/' })).toThrow(/origine seule/);
    expect(() => lireConfig({ DOSSIER_DONNEES: '/d', ORIGINE: 'https://a.fr', PORT: '0' })).toThrow(/PORT/);
  });
});
