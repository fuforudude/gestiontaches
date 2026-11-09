// Compte, sessions, tentatives de connexion et jeton MCP.
import { transaction, type Base } from './base.js';

export interface Admin {
  id: number;
  identifiant: string;
  hache: string;
}

export class DepotAcces {
  constructor(private readonly base: Base) {}

  adminParIdentifiant(identifiant: string): Admin | undefined {
    const l = this.base.prepare('select id, identifiant, hache from admin where identifiant = ?').get(identifiant);
    return l ? { id: Number(l.id), identifiant: String(l.identifiant), hache: String(l.hache) } : undefined;
  }

  /** Un seul compte : remplace l'éventuel compte existant et ferme toutes les sessions. */
  remplacerAdmin(identifiant: string, hache: string): void {
    transaction(this.base, () => {
      this.base.exec('delete from session; delete from admin;');
      this.base.prepare('insert into admin (identifiant, hache) values (?, ?)').run(identifiant, hache);
    });
  }

  creerSession(jetonHache: string, adminId: number, expireLe: number): void {
    this.base.prepare('insert into session (jeton_hache, admin_id, expire_le) values (?, ?, ?)').run(jetonHache, adminId, expireLe);
  }

  sessionValide(jetonHache: string, maintenant: number): boolean {
    return this.base.prepare('select 1 from session where jeton_hache = ? and expire_le > ?').get(jetonHache, maintenant) !== undefined;
  }

  supprimerSession(jetonHache: string): void {
    this.base.prepare('delete from session where jeton_hache = ?').run(jetonHache);
  }

  purger(maintenant: number, tentativesAvant: number): void {
    this.base.prepare('delete from session where expire_le <= ?').run(maintenant);
    this.base.prepare('delete from tentative_connexion where instant < ?').run(tentativesAvant);
  }

  /** Renvoie l'identifiant de la tentative, pour l'effacer si elle réussit. */
  noterTentative(ip: string, instant: number): number {
    return Number(this.base.prepare('insert into tentative_connexion (ip, instant) values (?, ?)').run(ip, instant).lastInsertRowid);
  }

  effacerTentative(id: number): void {
    this.base.prepare('delete from tentative_connexion where rowid = ?').run(id);
  }

  /** Instants des derniers échecs de cette adresse, du plus récent au plus ancien. */
  derniersEchecs(ip: string, nombre: number): number[] {
    return this.base
      .prepare('select instant from tentative_connexion where ip = ? order by instant desc limit ?')
      .all(ip, nombre)
      .map((l) => Number(l.instant));
  }

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
