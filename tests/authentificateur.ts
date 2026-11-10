// Authentificateur WebAuthn simulé pour les tests : vraie clé P-256, données signées comme le ferait un téléphone
// ou Windows Hello (attestation « none »), encodage CBOR minimal.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const b64url = (octets: Uint8Array) => Buffer.from(octets).toString('base64url');
const sha256 = (donnees: Uint8Array | string) => new Uint8Array(createHash('sha256').update(donnees).digest());

type ValeurCbor = number | string | Uint8Array | MapCbor | { [cle: string]: ValeurCbor };
// Interface vide voulue : elle rompt la récursion du type ValeurCbor.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MapCbor extends Map<ValeurCbor, ValeurCbor> {}

function enTete(majeur: number, valeur: number): number[] {
  if (valeur < 24) return [(majeur << 5) | valeur];
  if (valeur < 256) return [(majeur << 5) | 24, valeur];
  return [(majeur << 5) | 25, valeur >> 8, valeur & 0xff];
}

function cbor(valeur: ValeurCbor): number[] {
  if (typeof valeur === 'number') return valeur >= 0 ? enTete(0, valeur) : enTete(1, -1 - valeur);
  if (typeof valeur === 'string') {
    const octets = new TextEncoder().encode(valeur);
    return [...enTete(3, octets.length), ...octets];
  }
  if (valeur instanceof Uint8Array) return [...enTete(2, valeur.length), ...valeur];
  const entrees = valeur instanceof Map ? [...valeur.entries()] : Object.entries(valeur);
  return [...enTete(5, entrees.length), ...entrees.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
}

const concat = (...parties: Uint8Array[]) => new Uint8Array(Buffer.concat(parties));
const entier32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

const DRAPEAU = { presence: 0x01, verification: 0x04, donneesCle: 0x40 } as const;

export interface OptionsReponse {
  origine?: string;
  /** Sans vérification de l'utilisateur (pas d'empreinte ni de code) : doit être refusé. */
  sansVerification?: boolean;
  type?: string;
}

export class Authentificateur {
  readonly idCle = new Uint8Array(randomBytes(32));
  private readonly privee: KeyObject;
  private readonly cose: Uint8Array;
  compteur = 0;

  constructor(
    private readonly rpID: string,
    private readonly origine: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privee = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    const coord = (c: string | undefined) => new Uint8Array(Buffer.from(c ?? '', 'base64url'));
    this.cose = new Uint8Array(cbor(new Map<ValeurCbor, ValeurCbor>([[1, 2], [3, -7], [-1, 1], [-2, coord(jwk.x)], [-3, coord(jwk.y)]])));
  }

  get id(): string {
    return b64url(this.idCle);
  }

  private donneesClient(type: string, defi: string, options: OptionsReponse): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ type: options.type ?? type, challenge: defi, origin: options.origine ?? this.origine, crossOrigin: false }));
  }

  private drapeaux(options: OptionsReponse, extra = 0): Uint8Array {
    return new Uint8Array([DRAPEAU.presence | (options.sansVerification ? 0 : DRAPEAU.verification) | extra]);
  }

  /** Réponse à navigator.credentials.create(), au format JSON envoyé par le site. */
  creer(optionsServeur: { challenge: string }, options: OptionsReponse = {}) {
    const clientData = this.donneesClient('webauthn.create', optionsServeur.challenge, options);
    const longueurId = new Uint8Array([this.idCle.length >> 8, this.idCle.length & 0xff]);
    const authData = concat(sha256(this.rpID), this.drapeaux(options, DRAPEAU.donneesCle), entier32(this.compteur), new Uint8Array(16), longueurId, this.idCle, this.cose);
    const attestation = new Uint8Array(cbor({ fmt: 'none', attStmt: {}, authData }));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ['internal'] },
    };
  }

  /** Réponse à navigator.credentials.get(). */
  utiliser(optionsServeur: { challenge: string }, options: OptionsReponse = {}) {
    this.compteur += 1;
    const clientData = this.donneesClient('webauthn.get', optionsServeur.challenge, options);
    const authData = concat(sha256(this.rpID), this.drapeaux(options), entier32(this.compteur));
    const signature = sign('sha256', concat(authData, sha256(clientData)), this.privee);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(new Uint8Array(signature)) },
    };
  }
}
