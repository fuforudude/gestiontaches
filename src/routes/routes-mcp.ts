// Serveur MCP sur HTTP (transport « Streamable HTTP », sans état) : JSON-RPC en POST, réponse JSON directe.
// Accès par le jeton, soit dans le chemin (/mcp/<jeton>, pour les connecteurs claude.ai qui ne posent pas d'en-tête),
// soit en en-tête Authorization: Bearer <jeton> sur /mcp.
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Config } from '../config.js';
import { ErreurMetier } from '../domaine/erreurs.js';
import type { ServiceAcces } from '../services/service-acces.js';
import { CONSIGNES, OUTILS, type OutilsMcp } from '../services/outils-mcp.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const INFOS = { name: 'taches', title: 'Mes tâches', version: '1.0.0' };

type Id = string | number | null;

const erreurRpc = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const resultatRpc = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function routesMcp(acces: ServiceAcces, outils: OutilsMcp, config: Config): Hono {
  const mcp = new Hono();

  /** Traite un message ; undefined pour une notification (pas de réponse). */
  const traiter = (message: unknown): object | undefined => {
    if (!estObjet(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return erreurRpc(null, -32600, 'Requête JSON-RPC invalide.');
    }
    const { id, params } = message;
    const method = message.method;
    if (id === undefined) return undefined;
    if (typeof id !== 'string' && typeof id !== 'number') return erreurRpc(null, -32600, 'Identifiant invalide.');
    const p = estObjet(params) ? params : {};

    switch (method) {
      case 'initialize': {
        const demandee = p.protocolVersion;
        const version = VERSIONS.find((v) => v === demandee) ?? VERSIONS[0];
        return resultatRpc(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: INFOS,
          instructions: CONSIGNES,
        });
      }
      case 'ping':
        return resultatRpc(id, {});
      case 'tools/list':
        return resultatRpc(id, { tools: OUTILS });
      case 'tools/call': {
        const nom = p.name;
        if (typeof nom !== 'string' || !outils.existe(nom)) return erreurRpc(id, -32602, `Outil inconnu : ${String(nom)}.`);
        const args = estObjet(p.arguments) ? p.arguments : {};
        return resultatRpc(id, outils.appeler(nom, args));
      }
      default:
        return erreurRpc(id, -32601, `Méthode non prise en charge : ${method}.`);
    }
  };

  const point = async (c: Context, jeton: string | undefined) => {
    c.header('Cache-Control', 'no-store');
    // Protection contre le rebinding DNS : un navigateur envoie toujours Origin, les clients MCP non.
    const origine = c.req.header('origin');
    if (origine !== undefined && origine !== config.origine) throw new ErreurMetier('origine_refusee', 'Origine refusée.');
    if (!acces.jetonMcpValide(jeton)) return c.json(erreurRpc(null, -32001, 'Jeton invalide.'), 401);

    let corps: unknown;
    try {
      corps = await c.req.json();
    } catch {
      return c.json(erreurRpc(null, -32700, 'JSON illisible.'), 400);
    }
    if (Array.isArray(corps)) {
      if (corps.length === 0) return c.json(erreurRpc(null, -32600, 'Lot vide.'), 400);
      const reponses = corps.map(traiter).filter((r) => r !== undefined);
      return reponses.length === 0 ? c.body(null, 202) : c.json(reponses);
    }
    const reponse = traiter(corps);
    return reponse === undefined ? c.body(null, 202) : c.json(reponse);
  };

  mcp.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new ErreurMetier('trop_gros', 'Requête trop grosse.');
      },
    }),
  );

  const enTete = (c: Context) => /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  mcp.post('/', (c) => point(c, enTete(c)));
  mcp.post('/:jeton', (c) => point(c, c.req.param('jeton')));
  // Pas de flux d'événements serveur ni de session à fermer : seul POST est accepté.
  mcp.on(['GET', 'DELETE'], ['/', '/:jeton'], (c) => c.body(null, 405, { Allow: 'POST' }));

  return mcp;
}
