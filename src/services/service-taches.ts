// Règles des tâches, communes au site et au serveur MCP : validation, projet retrouvé ou créé par son nom, date de fin.
import { estViolationUnicite, transaction, type Base } from '../depots/base.js';
import type { ChampsTache, DepotTaches } from '../depots/depot-taches.js';
import { conflit, introuvable, validation } from '../domaine/erreurs.js';
import {
  detailsValides,
  nomProjetValide,
  statutValide,
  titreValide,
  type Projet,
  type Source,
  type Statut,
  type Tache,
} from '../domaine/taches.js';

export interface NouvelleTache {
  projet: unknown;
  titre: unknown;
  details?: unknown;
  statut?: unknown;
}

export interface Modification {
  projet?: unknown;
  titre?: unknown;
  details?: unknown;
  statut?: unknown;
}

export interface FiltreLecture {
  projet?: unknown;
  statuts?: readonly Statut[];
  faitesMax?: number;
}

export class ServiceTaches {
  constructor(
    private readonly base: Base,
    private readonly depot: DepotTaches,
    private readonly maintenant: () => number,
  ) {}

  projets(): Projet[] {
    return this.depot.projets();
  }

  /** Le projet du nom donné (sans tenir compte de la casse), créé s'il n'existe pas. */
  private projetOuCree(nom: unknown): number {
    const propre = nomProjetValide(nom);
    return this.depot.projetParNom(propre)?.id ?? this.depot.creerProjet(propre, this.maintenant());
  }

  creerProjet(nom: unknown): Projet {
    const propre = nomProjetValide(nom);
    if (this.depot.projetParNom(propre)) throw conflit(`Le projet « ${propre} » existe déjà.`);
    return this.projetExistant(this.depot.creerProjet(propre, this.maintenant()));
  }

  renommerProjet(id: number, nom: unknown): Projet {
    const propre = nomProjetValide(nom);
    let trouve: boolean;
    try {
      trouve = this.depot.renommerProjet(id, propre);
    } catch (erreur) {
      if (estViolationUnicite(erreur)) throw conflit(`Le projet « ${propre} » existe déjà.`);
      throw erreur;
    }
    if (!trouve) throw introuvable('Projet introuvable.');
    return this.projetExistant(id);
  }

  /** Supprime le projet et toutes ses tâches. */
  supprimerProjet(id: number): void {
    if (!this.depot.supprimerProjet(id)) throw introuvable('Projet introuvable.');
  }

  private projetExistant(id: number): Projet {
    const projet = this.depot.projet(id);
    if (!projet) throw introuvable('Projet introuvable.');
    return projet;
  }

  /** Un projet inconnu donne une liste vide, pas une erreur : Claude peut demander un projet qui n'a pas encore de tâche. */
  taches(filtre: FiltreLecture = {}): Tache[] {
    let projetId: number | undefined;
    if (filtre.projet !== undefined && filtre.projet !== null && filtre.projet !== '') {
      const projet = this.depot.projetParNom(nomProjetValide(filtre.projet));
      if (!projet) return [];
      projetId = projet.id;
    }
    return this.depot.taches({
      ...(projetId === undefined ? {} : { projetId }),
      ...(filtre.statuts === undefined ? {} : { statuts: filtre.statuts }),
      ...(filtre.faitesMax === undefined ? {} : { faitesMax: filtre.faitesMax }),
    });
  }

  tache(id: number): Tache {
    const tache = this.depot.tache(id);
    if (!tache) throw introuvable(`Tâche ${id} introuvable.`);
    return tache;
  }

  creerTache(entree: NouvelleTache, source: Source): Tache {
    const titre = titreValide(entree.titre);
    const details = detailsValides(entree.details);
    const statut = entree.statut === undefined || entree.statut === null ? 'a_faire' : statutValide(entree.statut);
    const id = transaction(this.base, () =>
      this.depot.creerTache({ projetId: this.projetOuCree(entree.projet), titre, details, statut, source, instant: this.maintenant() }),
    );
    return this.tache(id);
  }

  modifierTache(id: number, modification: Modification): Tache {
    const champs: ChampsTache = {};
    if (modification.titre !== undefined) champs.titre = titreValide(modification.titre);
    if (modification.details !== undefined) champs.details = detailsValides(modification.details);
    if (modification.statut !== undefined) champs.statut = statutValide(modification.statut);
    const changeProjet = modification.projet !== undefined;
    if (!changeProjet && Object.keys(champs).length === 0) throw validation('Rien à modifier.');

    const instant = this.maintenant();
    transaction(this.base, () => {
      const avant = this.tache(id);
      if (changeProjet) champs.projetId = this.projetOuCree(modification.projet);
      // La date de fin suit le statut : posée en passant à « faite », effacée en revenant en arrière.
      if (champs.statut !== undefined && champs.statut !== avant.statut) {
        champs.faiteLe = champs.statut === 'faite' ? instant : null;
      }
      this.depot.modifierTache(id, champs, instant);
    });
    return this.tache(id);
  }

  supprimerTache(id: number): Tache {
    const tache = this.tache(id);
    this.depot.supprimerTache(id);
    return tache;
  }
}
