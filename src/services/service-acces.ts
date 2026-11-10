// Connexion au site par clé d'accès (passkey, WebAuthn) : un seul utilisateur, plusieurs appareils.
// Une clé s'ajoute avec une session ouverte, ou avec un lien d'inscription à usage unique créé sur le serveur
// (`sudo taches-cle`), qui sert aussi de secours si tous les appareils sont perdus. Gère aussi le jeton MCP.
import { createHash, randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { CleAcces, DepotAcces } from '../depots/depot-acces.js';
import { ErreurMetier, introuvable, validation } from '../domaine/erreurs.js';

const MINUTE = 60 * 1000;
export const ACCES = {
  dureeSession: 90 * 24 * 60 * MINUTE,
  dureeDefi: 5 * MINUTE,
  dureeLien: 15 * MINUTE,
  longueurMaxNom: 60,
} as const;

/** Toutes les clés appartiennent au même utilisateur : un appareil n'en garde qu'une pour ce site. */
const ID_UTILISATEUR = new TextEncoder().encode('taches-utilisateur-unique');

const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');
const jetonAleatoire = () => randomBytes(32).toString('base64url');
const FORME_JETON = /^[A-Za-z0-9_-]{43}$/;

export interface Session {
  jeton: string;
  expireLe: number;
}

/** Ce que le site montre d'une clé. */
export interface CleVue {
  id: string;
  nom: string;
  creeLe: number;
  utiliseeLe: number | null;
}

const refusee = () => new ErreurMetier('non_connecte', 'Clé d’accès refusée.');

function nomValide(valeur: unknown): string {
  if (valeur === undefined || valeur === null || valeur === '') return 'Appareil';
  if (typeof valeur !== 'string') throw validation('Nom de l’appareil : texte attendu.');
  const propre = valeur.replace(/\s+/g, ' ').trim();
  if (propre.length > ACCES.longueurMaxNom) throw validation(`Nom de l’appareil : ${ACCES.longueurMaxNom} caractères au plus.`);
  return propre || 'Appareil';
}

/** Contrôle minimal de la forme avant de confier la réponse du navigateur à la bibliothèque. */
function verifierForme(valeur: unknown): asserts valeur is { id: string; response: object } {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw validation('Réponse de la clé attendue.');
  const r = valeur as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.response !== 'object' || r.response === null) throw validation('Réponse de la clé invalide.');
}

export class ServiceAcces {
  private readonly rpID: string;

  constructor(
    private readonly depot: DepotAcces,
    private readonly maintenant: () => number,
    private readonly origine: string,
  ) {
    this.rpID = new URL(origine).hostname;
  }

  // --- Sessions ---

  private ouvrirSession(): Session {
    const jeton = jetonAleatoire();
    const expireLe = this.maintenant() + ACCES.dureeSession;
    this.depot.creerSession(empreinte(jeton), expireLe);
    return { jeton, expireLe };
  }

  sessionValide(jeton: string | undefined): boolean {
    return jeton !== undefined && jeton.length > 0 && this.depot.sessionValide(empreinte(jeton), this.maintenant());
  }

  deconnecter(jeton: string | undefined): void {
    if (jeton) this.depot.supprimerSession(empreinte(jeton));
  }

  // --- Liens d'inscription ---

  /** Lien à usage unique, valable 15 minutes, pour enregistrer la clé d'un appareil. */
  creerLienInscription(): string {
    const jeton = jetonAleatoire();
    this.depot.creerLien(empreinte(jeton), this.maintenant() + ACCES.dureeLien);
    return `${this.origine}/?inscription=${jeton}`;
  }

  private lienValide(lien: unknown): lien is string {
    return typeof lien === 'string' && FORME_JETON.test(lien) && this.depot.lienValide(empreinte(lien), this.maintenant());
  }

  /** Une inscription exige une session ouverte ou un lien valide. */
  private autoriserInscription(sessionOuverte: boolean, lien: unknown): void {
    if (!sessionOuverte && !this.lienValide(lien)) {
      throw new ErreurMetier('non_connecte', 'Lien d’inscription invalide ou expiré : demandes-en un nouveau.');
    }
  }

  // --- Inscription d'une clé ---

  async optionsInscription(sessionOuverte: boolean, lien: unknown): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.depot.purger(this.maintenant());
    this.autoriserInscription(sessionOuverte, lien);
    const options = await generateRegistrationOptions({
      rpName: 'Mes tâches',
      rpID: this.rpID,
      userName: 'Mes tâches',
      userID: ID_UTILISATEUR,
      attestationType: 'none',
      excludeCredentials: this.depot.cles().map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.depot.creerDefi(options.challenge, 'inscription', this.maintenant() + ACCES.dureeDefi);
    return options;
  }

  /** Enregistre la clé ; avec un lien (appareil pas encore connecté), le consomme et ouvre une session. */
  async inscrire(sessionOuverte: boolean, entree: { lien?: unknown; nom?: unknown; reponse: unknown }): Promise<{ session?: Session; cle: CleVue }> {
    this.autoriserInscription(sessionOuverte, entree.lien);
    const nom = nomValide(entree.nom);
    const brute = entree.reponse;
    verifierForme(brute);
    const reponse = brute as unknown as RegistrationResponseJSON;
    const instant = this.maintenant();

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: reponse,
        expectedChallenge: (defi) => this.depot.consommerDefi(defi, 'inscription', instant),
        expectedOrigin: this.origine,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch {
      throw refusee();
    }
    if (!verification.verified) throw refusee();
    const { credential } = verification.registrationInfo;
    if (this.depot.cle(credential.id)) throw new ErreurMetier('conflit', 'Cet appareil a déjà une clé.');

    const viaLien = !sessionOuverte;
    // Le lien ne sert qu'une fois : deux inscriptions simultanées avec le même lien, une seule passe.
    if (viaLien && !this.depot.consommerLien(empreinte(String(entree.lien)), instant)) {
      throw new ErreurMetier('non_connecte', 'Lien d’inscription déjà utilisé.');
    }
    const cle: Omit<CleAcces, 'utiliseeLe'> = {
      id: credential.id,
      clePublique: credential.publicKey,
      compteur: credential.counter,
      transports: credential.transports ?? [],
      nom,
      creeLe: instant,
    };
    this.depot.ajouterCle(cle);
    const vue: CleVue = { id: cle.id, nom, creeLe: instant, utiliseeLe: null };
    return viaLien ? { session: this.ouvrirSession(), cle: vue } : { cle: vue };
  }

  // --- Connexion ---

  async optionsConnexion(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.depot.purger(this.maintenant());
    // Liste vide : le navigateur propose les clés de ce site que l'appareil connaît (clés « découvrables »).
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required', allowCredentials: [] });
    this.depot.creerDefi(options.challenge, 'connexion', this.maintenant() + ACCES.dureeDefi);
    return options;
  }

  async connecter(reponseBrute: unknown): Promise<Session> {
    verifierForme(reponseBrute);
    const reponse = reponseBrute as unknown as AuthenticationResponseJSON;
    const cle = this.depot.cle(reponse.id);
    if (!cle) throw refusee();
    const instant = this.maintenant();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: reponse,
        expectedChallenge: (defi) => this.depot.consommerDefi(defi, 'connexion', instant),
        expectedOrigin: this.origine,
        expectedRPID: this.rpID,
        credential: { id: cle.id, publicKey: cle.clePublique, counter: cle.compteur, transports: cle.transports },
        requireUserVerification: true,
      });
    } catch {
      throw refusee();
    }
    if (!verification.verified) throw refusee();
    this.depot.noterUtilisation(cle.id, verification.authenticationInfo.newCounter, instant);
    return this.ouvrirSession();
  }

  // --- Gestion des clés ---

  cles(): CleVue[] {
    return this.depot.cles().map(({ id, nom, creeLe, utiliseeLe }) => ({ id, nom, creeLe, utiliseeLe }));
  }

  supprimerCle(id: string): void {
    const resultat = this.depot.supprimerCle(id);
    if (resultat === 'introuvable') throw introuvable('Clé introuvable.');
    if (resultat === 'derniere') throw new ErreurMetier('conflit', 'C’est la dernière clé : ajoute un autre appareil avant de la retirer.');
  }

  // --- Jeton MCP ---

  /** Utilisé seulement par la commande lancée sur le serveur. Renvoie le nouveau jeton, qui révoque l'ancien. */
  nouveauJetonMcp(): string {
    const jeton = jetonAleatoire();
    this.depot.remplacerJetonMcp(empreinte(jeton), this.maintenant());
    return jeton;
  }

  jetonMcpValide(jeton: string | undefined): boolean {
    return jeton !== undefined && FORME_JETON.test(jeton) && this.depot.jetonMcpExiste(empreinte(jeton));
  }
}
