// Lecture et écriture des projets et des tâches.
import type { Projet, Source, Statut, Tache } from '../domaine/taches.js';
import type { Base } from './base.js';

type Ligne = Record<string, unknown>;

/** Clé d'unicité d'un nom de projet : « Études » et « études » sont le même projet. */
export const cleProjet = (nom: string) => nom.normalize('NFC').toLocaleLowerCase('fr');

const versProjet = (l: Ligne): Projet => ({
  id: Number(l.id),
  nom: String(l.nom),
  creeLe: Number(l.cree_le),
  aFaire: Number(l.a_faire ?? 0),
  enCours: Number(l.en_cours ?? 0),
  faites: Number(l.faites ?? 0),
});

const versTache = (l: Ligne): Tache => ({
  id: Number(l.id),
  projetId: Number(l.projet_id),
  projet: String(l.projet),
  titre: String(l.titre),
  details: String(l.details),
  statut: l.statut as Statut,
  source: l.source as Source,
  creeLe: Number(l.cree_le),
  modifieLe: Number(l.modifie_le),
  faiteLe: l.faite_le === null ? null : Number(l.faite_le),
});

const SELECT_PROJET = `
  select p.id, p.nom, p.cree_le,
    count(case when t.statut = 'a_faire' then 1 end) as a_faire,
    count(case when t.statut = 'en_cours' then 1 end) as en_cours,
    count(case when t.statut = 'faite' then 1 end) as faites
  from projet p left join tache t on t.projet_id = p.id`;

const SELECT_TACHE = `
  select t.id, t.projet_id, p.nom as projet, t.titre, t.details, t.statut, t.source, t.cree_le, t.modifie_le, t.faite_le
  from tache t join projet p on p.id = t.projet_id`;

// En cours d'abord, puis à faire (les plus anciennes en premier), puis faites (les plus récentes en premier).
const ORDRE_TACHES = `order by case t.statut when 'en_cours' then 0 when 'a_faire' then 1 else 2 end,
  case when t.statut = 'faite' then -t.faite_le else t.cree_le end, t.id`;

export interface FiltreTaches {
  projetId?: number;
  statuts?: readonly Statut[];
  /** Plafond du nombre de tâches faites renvoyées (les plus récentes). */
  faitesMax?: number;
}

export interface ChampsTache {
  projetId?: number;
  titre?: string;
  details?: string;
  statut?: Statut;
  faiteLe?: number | null;
}

const COLONNES: Record<keyof ChampsTache, string> = {
  projetId: 'projet_id',
  titre: 'titre',
  details: 'details',
  statut: 'statut',
  faiteLe: 'faite_le',
};

export class DepotTaches {
  constructor(private readonly base: Base) {}

  projets(): Projet[] {
    return this.base.prepare(`${SELECT_PROJET} group by p.id order by p.nom collate nocase`).all().map(versProjet);
  }

  projet(id: number): Projet | undefined {
    const l = this.base.prepare(`${SELECT_PROJET} where p.id = ? group by p.id`).get(id);
    return l ? versProjet(l) : undefined;
  }

  projetParNom(nom: string): Projet | undefined {
    const l = this.base.prepare(`${SELECT_PROJET} where p.cle = ? group by p.id`).get(cleProjet(nom));
    return l ? versProjet(l) : undefined;
  }

  creerProjet(nom: string, creeLe: number): number {
    return Number(this.base.prepare('insert into projet (nom, cle, cree_le) values (?, ?, ?)').run(nom, cleProjet(nom), creeLe).lastInsertRowid);
  }

  renommerProjet(id: number, nom: string): boolean {
    return this.base.prepare('update projet set nom = ?, cle = ? where id = ?').run(nom, cleProjet(nom), id).changes > 0;
  }

  supprimerProjet(id: number): boolean {
    return this.base.prepare('delete from projet where id = ?').run(id).changes > 0;
  }

  taches(filtre: FiltreTaches = {}): Tache[] {
    const conditions: string[] = [];
    const valeurs: (number | string)[] = [];
    if (filtre.projetId !== undefined) {
      conditions.push('t.projet_id = ?');
      valeurs.push(filtre.projetId);
    }
    if (filtre.statuts !== undefined) {
      if (filtre.statuts.length === 0) return [];
      conditions.push(`t.statut in (${filtre.statuts.map(() => '?').join(', ')})`);
      valeurs.push(...filtre.statuts);
    }
    if (filtre.faitesMax !== undefined) {
      // Les tâches faites au-delà des N plus récentes de chaque projet sont écartées.
      conditions.push(`(t.statut <> 'faite' or t.id in (
        select f.id from tache f where f.statut = 'faite' and f.projet_id = t.projet_id
        order by f.faite_le desc, f.id desc limit ?))`);
      valeurs.push(filtre.faitesMax);
    }
    const ou = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    return this.base.prepare(`${SELECT_TACHE} ${ou} ${ORDRE_TACHES}`).all(...valeurs).map(versTache);
  }

  tache(id: number): Tache | undefined {
    const l = this.base.prepare(`${SELECT_TACHE} where t.id = ?`).get(id);
    return l ? versTache(l) : undefined;
  }

  creerTache(t: { projetId: number; titre: string; details: string; statut: Statut; source: Source; instant: number }): number {
    const faiteLe = t.statut === 'faite' ? t.instant : null;
    const requete = this.base.prepare(
      `insert into tache (projet_id, titre, details, statut, source, cree_le, modifie_le, faite_le)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return Number(requete.run(t.projetId, t.titre, t.details, t.statut, t.source, t.instant, t.instant, faiteLe).lastInsertRowid);
  }

  modifierTache(id: number, champs: ChampsTache, instant: number): boolean {
    const affectations = ['modifie_le = ?'];
    const valeurs: (number | string | null)[] = [instant];
    for (const [cle, colonne] of Object.entries(COLONNES) as [keyof ChampsTache, string][]) {
      const valeur = champs[cle];
      if (valeur === undefined) continue;
      affectations.push(`${colonne} = ?`);
      valeurs.push(valeur);
    }
    return this.base.prepare(`update tache set ${affectations.join(', ')} where id = ?`).run(...valeurs, id).changes > 0;
  }

  supprimerTache(id: number): boolean {
    return this.base.prepare('delete from tache where id = ?').run(id).changes > 0;
  }
}
