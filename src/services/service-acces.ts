// Connexion au site (un seul compte), limitation des échecs par adresse IP, sessions, et jeton du serveur MCP.
import { createHash, randomBytes } from 'node:crypto';
import { ErreurMetier, validation } from '../domaine/erreurs.js';
import type { DepotAcces } from '../depots/depot-acces.js';
import { HACHE_LEURRE, hacher, verifier } from './mot-de-passe.js';

const MINUTE = 60 * 1000;
export const ACCES = {
  echecsMax: 5,
  fenetreEchecs: 15 * MINUTE,
  dureeBlocage: 15 * MINUTE,
  dureeSession: 7 * 24 * 60 * MINUTE,
  longueurMinMotDePasse: 12,
  longueurMaxSaisie: 1024,
} as const;

/** Une adresse IPv6 se compte par /64 : un attaquant en dispose d'un bloc entier. */
export function cleAdresse(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [avant = '', apres = ''] = ip.split('::');
  const gauche = avant ? avant.split(':') : [];
  const droite = apres ? apres.split(':') : [];
  const groupes = ip.includes('::')
    ? [...gauche, ...Array<string>(Math.max(0, 8 - gauche.length - droite.length)).fill('0'), ...droite]
    : gauche;
  return `${groupes.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');

export class ServiceAcces {
  // Un seul scrypt de connexion à la fois : une rafale ne monopolise pas les fils de Node.
  private file: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly depot: DepotAcces,
    private readonly maintenant: () => number,
  ) {}

  /** Renvoie le jeton de session à mettre dans le cookie. */
  connecter(identifiant: unknown, motDePasse: unknown, ip: string): Promise<{ jeton: string; expireLe: number }> {
    const suite = this.file.then(() => this.connecterSeul(identifiant, motDePasse, cleAdresse(ip)));
    this.file = suite.catch(() => undefined);
    return suite;
  }

  private async connecterSeul(identifiant: unknown, motDePasse: unknown, cle: string) {
    const instant = this.maintenant();
    this.depot.purger(instant, instant - ACCES.fenetreEchecs - ACCES.dureeBlocage);
    if (this.estBloquee(cle, instant)) {
      throw new ErreurMetier('trop_de_tentatives', 'Trop de tentatives : réessaie dans 15 minutes.');
    }
    if (
      typeof identifiant !== 'string' ||
      typeof motDePasse !== 'string' ||
      identifiant.length > ACCES.longueurMaxSaisie ||
      motDePasse.length > ACCES.longueurMaxSaisie
    ) {
      throw validation('Identifiant et mot de passe requis.');
    }

    // Notée comme un échec avant la vérification, effacée si elle réussit : des requêtes simultanées comptent toutes.
    const tentative = this.depot.noterTentative(cle, instant);
    const admin = this.depot.adminParIdentifiant(identifiant);
    const bon = await verifier(motDePasse, admin?.hache ?? HACHE_LEURRE);
    if (!admin || !bon) throw new ErreurMetier('non_connecte', 'Identifiant ou mot de passe incorrect.');
    this.depot.effacerTentative(tentative);
    const jeton = randomBytes(32).toString('base64url');
    const expireLe = instant + ACCES.dureeSession;
    this.depot.creerSession(empreinte(jeton), admin.id, expireLe);
    return { jeton, expireLe };
  }

  /** Bloquée tant que les 5 derniers échecs tiennent dans 15 minutes et que le dernier a moins de 15 minutes. */
  private estBloquee(ip: string, instant: number): boolean {
    const echecs = this.depot.derniersEchecs(ip, ACCES.echecsMax);
    const dernier = echecs[0];
    const cinquieme = echecs[ACCES.echecsMax - 1];
    if (dernier === undefined || cinquieme === undefined) return false;
    return dernier - cinquieme <= ACCES.fenetreEchecs && instant - dernier < ACCES.dureeBlocage;
  }

  sessionValide(jeton: string | undefined): boolean {
    return jeton !== undefined && jeton.length > 0 && this.depot.sessionValide(empreinte(jeton), this.maintenant());
  }

  deconnecter(jeton: string | undefined): void {
    if (jeton) this.depot.supprimerSession(empreinte(jeton));
  }

  /** Utilisé seulement par la commande lancée sur le serveur. Remplace le compte et ferme les sessions ouvertes. */
  async definirAdmin(identifiant: string, motDePasse: string): Promise<void> {
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(identifiant)) throw validation('Identifiant : 3 à 40 lettres, chiffres, point, tiret.');
    if (motDePasse.length < ACCES.longueurMinMotDePasse) {
      throw validation(`Mot de passe : ${ACCES.longueurMinMotDePasse} caractères au moins.`);
    }
    this.depot.remplacerAdmin(identifiant, await hacher(motDePasse));
  }

  /** Utilisé seulement par la commande lancée sur le serveur. Renvoie le nouveau jeton, qui révoque l'ancien. */
  nouveauJetonMcp(): string {
    const jeton = randomBytes(32).toString('base64url');
    this.depot.remplacerJetonMcp(empreinte(jeton), this.maintenant());
    return jeton;
  }

  jetonMcpValide(jeton: string | undefined): boolean {
    return jeton !== undefined && /^[A-Za-z0-9_-]{43}$/.test(jeton) && this.depot.jetonMcpExiste(empreinte(jeton));
  }
}
