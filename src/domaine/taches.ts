// Projets et tâches : types et règles de saisie, sans dépendance.
import { validation } from './erreurs.js';

export const STATUTS = ['a_faire', 'en_cours', 'faite'] as const;
export type Statut = (typeof STATUTS)[number];
export type Source = 'claude' | 'site';

export const LIMITES = { nomProjet: 80, titre: 200, details: 4000 } as const;

export interface Projet {
  id: number;
  nom: string;
  creeLe: number;
  aFaire: number;
  enCours: number;
  faites: number;
}

export interface Tache {
  id: number;
  projetId: number;
  projet: string;
  titre: string;
  details: string;
  statut: Statut;
  source: Source;
  creeLe: number;
  modifieLe: number;
  faiteLe: number | null;
}

/** Espaces de bord retirés, espaces internes réduits à un seul. */
function texteCourt(valeur: unknown, nom: string, max: number): string {
  if (typeof valeur !== 'string') throw validation(`${nom} requis.`);
  const propre = valeur.replace(/\s+/g, ' ').trim();
  if (propre.length === 0) throw validation(`${nom} requis.`);
  if (propre.length > max) throw validation(`${nom} : ${max} caractères au plus.`);
  return propre;
}

export const nomProjetValide = (valeur: unknown) => texteCourt(valeur, 'Nom du projet', LIMITES.nomProjet);
export const titreValide = (valeur: unknown) => texteCourt(valeur, 'Titre', LIMITES.titre);

export function detailsValides(valeur: unknown): string {
  if (valeur === undefined || valeur === null) return '';
  if (typeof valeur !== 'string') throw validation('Détails : texte attendu.');
  const propre = valeur.replace(/\r\n/g, '\n').trim();
  if (propre.length > LIMITES.details) throw validation(`Détails : ${LIMITES.details} caractères au plus.`);
  return propre;
}

export function statutValide(valeur: unknown): Statut {
  if (typeof valeur === 'string' && (STATUTS as readonly string[]).includes(valeur)) return valeur as Statut;
  throw validation(`Statut : ${STATUTS.join(', ')}.`);
}
