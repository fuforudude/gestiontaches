// Base SQLite (node:sqlite) : ouverture, schéma versionné par PRAGMA user_version, transactions.
import { DatabaseSync } from 'node:sqlite';

// Une migration appliquée ne se réécrit jamais : on en ajoute une nouvelle à la fin.
export const MIGRATIONS: readonly string[] = [
  `
  create table projet (
    id integer primary key,
    nom text not null,
    -- Nom en minuscules (toutes langues, accents compris) : deux projets ne diffèrent pas que par la casse.
    cle text not null unique,
    cree_le integer not null
  );
  create table tache (
    id integer primary key,
    projet_id integer not null references projet(id) on delete cascade,
    titre text not null,
    details text not null default '',
    statut text not null check (statut in ('a_faire', 'en_cours', 'faite')),
    source text not null check (source in ('claude', 'site')),
    cree_le integer not null,
    modifie_le integer not null,
    faite_le integer
  );
  create index tache_par_projet on tache(projet_id, statut);
  create table admin (
    id integer primary key,
    identifiant text not null unique,
    hache text not null
  );
  create table session (
    jeton_hache text primary key,
    admin_id integer not null references admin(id) on delete cascade,
    expire_le integer not null
  );
  create table tentative_connexion (
    ip text not null,
    instant integer not null
  );
  create index tentative_par_ip on tentative_connexion(ip, instant);
  create table jeton_mcp (
    empreinte text primary key,
    cree_le integer not null
  );
  `,
];

export type Base = DatabaseSync;

export function ouvrirBase(chemin: string): Base {
  const base = new DatabaseSync(chemin);
  base.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  migrer(base);
  return base;
}

function migrer(base: Base): void {
  const ligne = base.prepare('pragma user_version').get();
  const actuelle = Number(ligne?.user_version ?? 0);
  for (let i = actuelle; i < MIGRATIONS.length; i++) {
    transaction(base, () => {
      base.exec(MIGRATIONS[i] ?? '');
      base.exec(`pragma user_version = ${i + 1}`);
    });
  }
}

export function transaction<T>(base: Base, travail: () => T): T {
  base.exec('begin immediate');
  try {
    const resultat = travail();
    base.exec('commit');
    return resultat;
  } catch (erreur) {
    base.exec('rollback');
    throw erreur;
  }
}

export function estViolationUnicite(erreur: unknown): boolean {
  return erreur instanceof Error && erreur.message.includes('UNIQUE constraint failed');
}
