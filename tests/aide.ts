// Application de test : base en mémoire, horloge réglable, compte connecté et jeton MCP prêts.
import { creerApplication, type Application } from '../src/app.js';
import type { Config } from '../src/config.js';

export const ORIGINE = 'https://taches.exemple.test';
export const IDENTIFIANT = 'titouan';
export const MOT_DE_PASSE = 'un mot de passe assez long';

export interface Banc extends Application {
  horloge: { instant: number };
  cookie: string;
  jeton: string;
  requete: (chemin: string, init?: RequestInit) => Promise<Response>;
  /** Appel de l'API du site, connecté. */
  site: (methode: string, chemin: string, corps?: unknown) => Promise<Response>;
  /** Message JSON-RPC envoyé au serveur MCP avec le bon jeton. */
  mcp: (corps: unknown, chemin?: string, entetes?: Record<string, string>) => Promise<Response>;
  /** Appel d'un outil MCP ; renvoie le résultat de l'outil. */
  outil: (nom: string, args?: Record<string, unknown>) => Promise<{ isError?: boolean; valeur: unknown; texte: string }>;
  fermer: () => void;
}

export async function creerBanc(): Promise<Banc> {
  const config: Config = { port: 0, dossierDonnees: '.', origine: ORIGINE, cookieSecurise: true };
  const horloge = { instant: Date.UTC(2026, 10, 9, 12) };
  const application = creerApplication(config, { cheminBase: ':memory:', maintenant: () => horloge.instant });
  await application.acces.definirAdmin(IDENTIFIANT, MOT_DE_PASSE);
  const jeton = application.acces.nouveauJetonMcp();

  const requete = (chemin: string, init?: RequestInit) => Promise.resolve(application.app.request(chemin, init));
  let numero = 0;

  const banc: Banc = {
    ...application,
    horloge,
    cookie: '',
    jeton,
    requete,
    site: (methode, chemin, corps) =>
      requete(`/api${chemin}`, {
        method: methode,
        headers: { origin: ORIGINE, cookie: banc.cookie, ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      }),
    mcp: (corps, chemin = `/mcp/${jeton}`, entetes = {}) =>
      requete(chemin, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...entetes },
        body: typeof corps === 'string' ? corps : JSON.stringify(corps),
      }),
    outil: async (nom, args = {}) => {
      const reponse = await banc.mcp({ jsonrpc: '2.0', id: ++numero, method: 'tools/call', params: { name: nom, arguments: args } });
      const { result } = (await reponse.json()) as { result: { isError?: boolean; content: { text: string }[] } };
      const texte = result.content[0]?.text ?? '';
      let valeur: unknown = texte;
      try {
        valeur = JSON.parse(texte);
      } catch {
        /* message d'erreur en clair */
      }
      return { ...(result.isError ? { isError: true } : {}), valeur, texte };
    },
    fermer: () => {
      application.base.close();
    },
  };
  banc.cookie = await connecter(banc);
  return banc;
}

export async function connecter(banc: Banc, motDePasse = MOT_DE_PASSE, ip = '203.0.113.1'): Promise<string> {
  const reponse = await banc.requete('/api/connexion', {
    method: 'POST',
    headers: { origin: ORIGINE, 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ identifiant: IDENTIFIANT, motDePasse }),
  });
  if (reponse.status !== 200) return '';
  return (reponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
