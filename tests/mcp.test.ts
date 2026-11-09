// Serveur MCP : protocole, accès par jeton, outils.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerBanc, ORIGINE, type Banc } from './aide.js';

let banc: Banc;
beforeEach(async () => {
  banc = await creerBanc();
});
afterEach(() => {
  banc.fermer();
});

interface TacheVue {
  id: number;
  projet: string;
  titre: string;
  statut: string;
  details?: string;
  faiteLe?: string;
}

describe('protocole', () => {
  it('répond à initialize avec la version demandée, les outils et les consignes', async () => {
    const reponse = await banc.mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    expect(reponse.status).toBe(200);
    const { result } = (await reponse.json()) as { result: { protocolVersion: string; capabilities: object; instructions: string } };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.instructions).toMatch(/terminer_tache/);
  });

  it('propose sa version la plus récente si celle demandée est inconnue', async () => {
    const reponse = await banc.mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(((await reponse.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-11-25');
  });

  it('accepte une notification sans réponse (202)', async () => {
    const reponse = await banc.mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(reponse.status).toBe(202);
    expect(await reponse.text()).toBe('');
  });

  it('liste les six outils et répond au ping', async () => {
    const liste = (await (await banc.mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } };
    expect(liste.result.tools.map((o) => o.name)).toEqual([
      'lister_projets',
      'lister_taches',
      'creer_tache',
      'modifier_tache',
      'terminer_tache',
      'supprimer_tache',
    ]);
    expect(await (await banc.mcp({ jsonrpc: '2.0', id: 3, method: 'ping' })).json()).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('traite un lot et ignore les notifications du lot', async () => {
    const reponse = await banc.mcp([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(await reponse.json()).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    expect((await banc.mcp([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).status).toBe(202);
    expect((await banc.mcp([])).status).toBe(400);
  });

  it('signale les erreurs JSON-RPC', async () => {
    const code = async (corps: unknown) => ((await (await banc.mcp(corps)).json()) as { error: { code: number } }).error.code;
    expect(await code('{pas du json')).toBe(-32700);
    expect(await code({ id: 1, method: 'ping' })).toBe(-32600);
    expect(await code({ jsonrpc: '2.0', id: { x: 1 }, method: 'ping' })).toBe(-32600);
    expect(await code({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).toBe(-32601);
    expect(await code({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'inconnu' } })).toBe(-32602);
  });

  it('refuse GET et DELETE (pas de flux serveur)', async () => {
    const reponse = await banc.requete(`/mcp/${banc.jeton}`, { method: 'GET' });
    expect(reponse.status).toBe(405);
    expect(reponse.headers.get('allow')).toBe('POST');
  });
});

describe('accès', () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };

  it('refuse un jeton faux ou absent', async () => {
    expect((await banc.mcp(ping, `/mcp/${'x'.repeat(43)}`)).status).toBe(401);
    expect((await banc.mcp(ping, '/mcp/court')).status).toBe(401);
    expect((await banc.mcp(ping, '/mcp')).status).toBe(401);
  });

  it('accepte le jeton en en-tête Authorization', async () => {
    expect((await banc.mcp(ping, '/mcp', { authorization: `Bearer ${banc.jeton}` })).status).toBe(200);
  });

  it('un nouveau jeton révoque l\'ancien', async () => {
    const ancien = banc.jeton;
    const nouveau = banc.acces.nouveauJetonMcp();
    expect((await banc.mcp(ping, `/mcp/${ancien}`)).status).toBe(401);
    expect((await banc.mcp(ping, `/mcp/${nouveau}`)).status).toBe(200);
  });

  it('refuse une page web d\'une autre origine, accepte la sienne', async () => {
    expect((await banc.mcp(ping, undefined, { origin: 'https://mechant.exemple' })).status).toBe(403);
    expect((await banc.mcp(ping, undefined, { origin: ORIGINE })).status).toBe(200);
  });

  it('refuse un corps trop gros', async () => {
    const reponse = await banc.mcp({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(70 * 1024) } });
    expect(reponse.status).toBe(413);
  });
});

describe('outils', () => {
  it('crée une tâche et son projet, sans doublon de projet selon la casse', async () => {
    const a = await banc.outil('creer_tache', { projet: 'Multiplay', titre: '  Ajouter   le mode   nuit ', details: 'Voir la spec' });
    expect(a.isError).toBeUndefined();
    expect(a.valeur).toMatchObject({ projet: 'Multiplay', titre: 'Ajouter le mode nuit', statut: 'a_faire', details: 'Voir la spec', creeLe: '2026-11-09' });
    await banc.outil('creer_tache', { projet: 'multiplay', titre: 'Autre', statut: 'en_cours' });
    const projets = (await banc.outil('lister_projets')).valeur;
    expect(projets).toEqual([{ nom: 'Multiplay', aFaire: 1, enCours: 1, faites: 0 }]);
  });

  it('liste les tâches ouvertes par défaut, en cours d\'abord, et filtre par projet et statut', async () => {
    await banc.outil('creer_tache', { projet: 'A', titre: 'a1' });
    banc.horloge.instant += 1000;
    await banc.outil('creer_tache', { projet: 'A', titre: 'a2', statut: 'en_cours' });
    await banc.outil('creer_tache', { projet: 'B', titre: 'b1', statut: 'faite' });

    const titres = async (args: Record<string, unknown>) => ((await banc.outil('lister_taches', args)).valeur as TacheVue[]).map((t) => t.titre);
    expect(await titres({})).toEqual(['a2', 'a1']);
    expect(await titres({ projet: 'a' })).toEqual(['a2', 'a1']);
    expect(await titres({ statut: 'faites' })).toEqual(['b1']);
    expect(await titres({ statut: 'toutes' })).toEqual(['a2', 'a1', 'b1']);
    expect(await titres({ statut: 'en_cours' })).toEqual(['a2']);
    expect(await titres({ projet: 'Inconnu' })).toEqual([]);
    expect((await banc.outil('lister_taches', { statut: 'bof' })).isError).toBe(true);
  });

  it('modifie, coche puis supprime une tâche', async () => {
    const { id } = (await banc.outil('creer_tache', { projet: 'A', titre: 'x' })).valeur as TacheVue;
    banc.horloge.instant = Date.UTC(2026, 10, 10, 9);
    const modifiee = (await banc.outil('modifier_tache', { id, titre: 'y', details: 'à moitié', statut: 'en_cours', projet: 'B' })).valeur;
    expect(modifiee).toMatchObject({ id, titre: 'y', details: 'à moitié', statut: 'en_cours', projet: 'B' });

    const faite = (await banc.outil('terminer_tache', { id })).valeur as TacheVue;
    expect(faite).toMatchObject({ statut: 'faite', faiteLe: '2026-11-10' });

    expect((await banc.outil('supprimer_tache', { id })).valeur).toMatchObject({ supprimee: { id } });
    const absente = await banc.outil('terminer_tache', { id });
    expect(absente).toMatchObject({ isError: true, texte: `Tâche ${id} introuvable.` });
  });

  it('renvoie les erreurs de saisie comme résultats en erreur', async () => {
    expect((await banc.outil('creer_tache', { projet: 'A', titre: '   ' })).texte).toBe('Titre requis.');
    expect((await banc.outil('creer_tache', { titre: 'x' })).texte).toBe('Nom du projet requis.');
    expect((await banc.outil('creer_tache', { projet: 'A', titre: 'x', statut: 'fini' })).isError).toBe(true);
    expect((await banc.outil('creer_tache', { projet: 'A', titre: 'x'.repeat(201) })).texte).toMatch(/200 caractères/);
    expect((await banc.outil('modifier_tache', { id: 'trois' })).texte).toMatch(/id/);
    const { id } = (await banc.outil('creer_tache', { projet: 'A', titre: 'x' })).valeur as TacheVue;
    expect((await banc.outil('modifier_tache', { id })).texte).toBe('Rien à modifier.');
  });

  it('limite les tâches faites aux 20 plus récentes par projet', async () => {
    for (let i = 0; i < 25; i++) {
      banc.horloge.instant += 1000;
      await banc.outil('creer_tache', { projet: 'A', titre: `t${i}`, statut: 'faite' });
    }
    banc.horloge.instant += 1000;
    await banc.outil('creer_tache', { projet: 'B', titre: 'b', statut: 'faite' });
    const faites = (await banc.outil('lister_taches', { statut: 'faites' })).valeur as TacheVue[];
    expect(faites.filter((t) => t.projet === 'A')).toHaveLength(20);
    expect(faites[0]?.titre).toBe('b');
    expect(faites.some((t) => t.titre === 't24')).toBe(true);
    expect(faites.some((t) => t.titre === 't0')).toBe(false);
  });
});
