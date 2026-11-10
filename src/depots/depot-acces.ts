// Sessions, clés d'accès (passkeys), défis WebAuthn, liens d'inscription à usage unique et jeton MCP.
import { transaction, type Base } from './base.js';

export interface CleAcces {
  id: string;
  clePublique: Uint8Array<ArrayBuffer>;
  compteur: number;
  transports: string[];
  nom: string;
  creeLe: number;
  utiliseeLe: number | null;
}

export type UsageDefi = 'inscription' | 'connexion';

const versCle = (l: Record<string, unknown>): CleAcces => ({
  id: String(l.id),
  clePublique: new Uint8Array(l.cle_publique as Uint8Array),
  compteur: Number(l.compteur),
  transports: String(l.transports).split(',').filter((t) => t !== ''),
  nom: String(l.nom),
  creeLe: Number(l.cree_le),
  utiliseeLe: l.utilisee_le === null ? null : Number(l.utilisee_le),
});

export class DepotAcces {
  constructor(private readonly base: Base) {}

  // --- Sessions ---

  creerSession(jetonHache: string, expireLe: number): void {
    this.base.prepare('insert into session (jeton_hache, expire_le) values (?, ?)').run(jetonHache, expireLe);
  }

  sessionValide(jetonHache: string, maintenant: number): boolean {
    return this.base.prepare('select 1 from session where jeton_hache = ? and expire_le > ?').get(jetonHache, maintenant) !== undefined;
  }

  supprimerSession(jetonHache: string): void {
    this.base.prepare('delete from session where jeton_hache = ?').run(jetonHache);
  }

  /** Efface sessions, défis et liens expirés. */
  purger(maintenant: number): void {
    this.base.prepare('delete from session where expire_le <= ?').run(maintenant);
    this.base.prepare('delete from defi where expire_le <= ?').run(maintenant);
    this.base.prepare('delete from lien_inscription where expire_le <= ?').run(maintenant);
  }

  // --- Clés d'accès ---

  cles(): CleAcces[] {
    return this.base.prepare('select * from cle_acces order by cree_le').all().map(versCle);
  }

  cle(id: string): CleAcces | undefined {
    const l = this.base.prepare('select * from cle_acces where id = ?').get(id);
    return l ? versCle(l) : undefined;
  }

  ajouterCle(cle: Omit<CleAcces, 'utiliseeLe'>): void {
    this.base
      .prepare('insert into cle_acces (id, cle_publique, compteur, transports, nom, cree_le) values (?, ?, ?, ?, ?, ?)')
      .run(cle.id, cle.clePublique, cle.compteur, cle.transports.join(','), cle.nom, cle.creeLe);
  }

  noterUtilisation(id: string, compteur: number, instant: number): void {
    this.base.prepare('update cle_acces set compteur = ?, utilisee_le = ? where id = ?').run(compteur, instant, id);
  }

  /** Refuse de retirer la dernière clé : sans clé, seul l'accès au serveur permettrait de revenir. */
  supprimerCle(id: string): 'supprimee' | 'introuvable' | 'derniere' {
    return transaction(this.base, () => {
      if (!this.cle(id)) return 'introuvable';
      const nombre = Number(this.base.prepare('select count(*) as n from cle_acces').get()?.n ?? 0);
      if (nombre <= 1) return 'derniere';
      this.base.prepare('delete from cle_acces where id = ?').run(id);
      return 'supprimee';
    });
  }

  // --- Défis (un défi ne sert qu'une fois) ---

  creerDefi(valeur: string, usage: UsageDefi, expireLe: number): void {
    this.base.prepare('insert into defi (valeur, usage, expire_le) values (?, ?, ?)').run(valeur, usage, expireLe);
  }

  /** Consomme le défi : vrai s'il existait, avait cet usage et n'était pas expiré. */
  consommerDefi(valeur: string, usage: UsageDefi, maintenant: number): boolean {
    return this.base.prepare('delete from defi where valeur = ? and usage = ? and expire_le > ?').run(valeur, usage, maintenant).changes > 0;
  }

  // --- Liens d'inscription ---

  creerLien(empreinte: string, expireLe: number): void {
    this.base.prepare('insert into lien_inscription (empreinte, expire_le) values (?, ?)').run(empreinte, expireLe);
  }

  lienValide(empreinte: string, maintenant: number): boolean {
    return this.base.prepare('select 1 from lien_inscription where empreinte = ? and expire_le > ?').get(empreinte, maintenant) !== undefined;
  }

  consommerLien(empreinte: string, maintenant: number): boolean {
    return this.base.prepare('delete from lien_inscription where empreinte = ? and expire_le > ?').run(empreinte, maintenant).changes > 0;
  }

  // --- Jeton MCP ---

  /** Un seul jeton MCP à la fois : en créer un révoque le précédent. */
  remplacerJetonMcp(empreinte: string, creeLe: number): void {
    transaction(this.base, () => {
      this.base.exec('delete from jeton_mcp');
      this.base.prepare('insert into jeton_mcp (empreinte, cree_le) values (?, ?)').run(empreinte, creeLe);
    });
  }

  jetonMcpExiste(empreinte: string): boolean {
    return this.base.prepare('select 1 from jeton_mcp where empreinte = ?').get(empreinte) !== undefined;
  }
}
