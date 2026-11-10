// Application de test : base en mémoire, horloge réglable, un appareil inscrit et connecté, jeton MCP prêt.
import { creerApplication, type Application } from '../src/app.js';
import type { Config } from '../src/config.js';
import { Authentificateur } from './authentificateur.js';

export const ORIGINE = 'https://taches.exemple.test';
export const RP_ID = 'taches.exemple.test';

export interface Banc extends Application {
  horloge: { instant: number };
  /** Cookie de session de l'appareil inscrit. */
  cookie: string;
  appareil: Authentificateur;
  jeton: string;
  requete: (chemin: string, init?: RequestInit) => Promise<Response>;
  /** Appel de l'API du site avec le cookie donné (par défaut celui de l'appareil connecté). */
  site: (methode: string, chemin: string, corps?: unknown, cookie?: string) => Promise<Response>;
  mcp: (corps: unknown, chemin?: string, entetes?: Record<string, string>) => Promise<Response>;
  outil: (nom: string, args?: Record<string, unknown>) => Promise<{ isError?: boolean; valeur: unknown; texte: string }>;
  fermer: () => void;
}

export const nouvelAppareil = () => new Authentificateur(RP_ID, ORIGINE);
export const cookieDe = (reponse: Response) => (reponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
export const jetonDuLien = (lien: string) => new URL(lien).searchParams.get('inscription') ?? '';

/** Inscription complète d'un appareil avec un lien : renvoie la réponse finale (cookie de session dedans). */
export async function inscrireAvecLien(banc: Banc, appareil: Authentificateur, lien: string, nom = 'PC'): Promise<Response> {
  const options = (await (await banc.site('POST', '/cles/options', { lien }, '')).json()) as { challenge: string };
  return banc.site('POST', '/cles', { lien, nom, reponse: appareil.creer(options) }, '');
}

/** Connexion d'un appareil déjà inscrit. */
export async function connecterAppareil(banc: Banc, appareil: Authentificateur): Promise<Response> {
  const options = (await (await banc.site('POST', '/connexion/options', {}, '')).json()) as { challenge: string };
  return banc.site('POST', '/connexion', { reponse: appareil.utiliser(options) }, '');
}

export async function creerBanc(): Promise<Banc> {
  const config: Config = { port: 0, dossierDonnees: '.', origine: ORIGINE, cookieSecurise: true };
  const horloge = { instant: Date.UTC(2026, 10, 9, 12) };
  const application = creerApplication(config, { cheminBase: ':memory:', maintenant: () => horloge.instant });
  const jeton = application.acces.nouveauJetonMcp();

  const requete = (chemin: string, init?: RequestInit) => Promise.resolve(application.app.request(chemin, init));
  let numero = 0;

  const banc: Banc = {
    ...application,
    horloge,
    cookie: '',
    appareil: nouvelAppareil(),
    jeton,
    requete,
    site: (methode, chemin, corps, cookie) =>
      requete(`/api${chemin}`, {
        method: methode,
        headers: { origin: ORIGINE, cookie: cookie ?? banc.cookie, ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
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
  const inscription = await inscrireAvecLien(banc, banc.appareil, jetonDuLien(application.acces.creerLienInscription()));
  if (inscription.status !== 201) throw new Error(`Inscription refusée : ${inscription.status} ${await inscription.text()}`);
  banc.cookie = cookieDe(inscription);
  return banc;
}
