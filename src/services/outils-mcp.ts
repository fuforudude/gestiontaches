// Les outils MCP offerts à Claude : description, schéma des arguments et exécution par le service des tâches.
// Indépendant du transport HTTP (voir routes/routes-mcp.ts).
import { ErreurMetier, validation } from '../domaine/erreurs.js';
import { STATUTS, type Projet, type Statut, type Tache } from '../domaine/taches.js';
import type { ServiceTaches } from './service-taches.js';

/** Consignes envoyées à Claude à l'ouverture de la connexion (champ `instructions` de MCP). */
export const CONSIGNES = `Outil de suivi des tâches de l'utilisateur, rangées par projet. L'utilisateur consulte ces tâches sur son site et y coche ce qui est fait : garde l'outil à jour sans qu'on te le demande, dans toute conversation où un travail réel avance.
- Au début d'un travail : lister_taches du projet concerné pour retrouver une tâche existante plutôt que d'en créer un doublon ; passe-la « en_cours » (ou crée-la directement « en_cours »).
- Une tâche = un résultat concret et vérifiable, avec un titre court à l'infinitif (« Ajouter la connexion Google »). Pas une tâche par petite étape technique.
- Quand c'est terminé et vérifié : terminer_tache. Si ce n'est fait qu'en partie, laisse-la « en_cours » et note où ça en est dans « details ».
- Ce qui reste à faire ensuite (suites, idées de l'utilisateur, problèmes repérés en passant) : creer_tache en « a_faire ».
- Le nom du projet : celui du dépôt ou du dossier de travail (par exemple « Multiplay », « Pocharlume »), toujours écrit de la même façon ; lister_projets donne les noms déjà utilisés. Hors code, un nom de projet parlant (« Perso », « Études »…).
- Ne supprime une tâche que si l'utilisateur le demande ou si tu viens de la créer par erreur.`;

interface Outil {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

const STATUT_SCHEMA = { type: 'string', enum: [...STATUTS], description: 'a_faire, en_cours ou faite.' };
const ID_SCHEMA = { type: 'integer', minimum: 1, description: 'Numéro de la tâche (champ id).' };
const PROJET_SCHEMA = { type: 'string', description: 'Nom du projet ; créé automatiquement s\'il n\'existe pas encore.' };

export const OUTILS: readonly Outil[] = [
  {
    name: 'lister_projets',
    title: 'Lister les projets',
    description: 'Liste les projets avec le nombre de tâches à faire, en cours et faites.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'lister_taches',
    title: 'Lister les tâches',
    description:
      'Liste les tâches, en cours d\'abord. Par défaut les tâches ouvertes (à faire et en cours) de tous les projets. Les tâches faites sont limitées aux 20 plus récentes par projet.',
    inputSchema: {
      type: 'object',
      properties: {
        projet: { type: 'string', description: 'Nom du projet (sans tenir compte des majuscules). Absent : tous les projets.' },
        statut: {
          type: 'string',
          enum: ['ouvertes', 'a_faire', 'en_cours', 'faites', 'toutes'],
          description: 'ouvertes (par défaut) = à faire + en cours.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'creer_tache',
    title: 'Créer une tâche',
    description: 'Ajoute une tâche à un projet (créé au besoin). Statut « a_faire » par défaut.',
    inputSchema: {
      type: 'object',
      properties: {
        projet: PROJET_SCHEMA,
        titre: { type: 'string', maxLength: 200, description: 'Court, à l\'infinitif.' },
        details: { type: 'string', maxLength: 4000, description: 'Contexte utile pour reprendre la tâche plus tard.' },
        statut: STATUT_SCHEMA,
      },
      required: ['projet', 'titre'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'modifier_tache',
    title: 'Modifier une tâche',
    description: 'Change le titre, les détails, le statut ou le projet d\'une tâche. Seuls les champs donnés changent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID_SCHEMA,
        titre: { type: 'string', maxLength: 200 },
        details: { type: 'string', maxLength: 4000, description: 'Remplace les détails existants.' },
        statut: STATUT_SCHEMA,
        projet: PROJET_SCHEMA,
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'terminer_tache',
    title: 'Cocher une tâche',
    description: 'Marque une tâche comme faite.',
    inputSchema: { type: 'object', properties: { id: ID_SCHEMA }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'supprimer_tache',
    title: 'Supprimer une tâche',
    description: 'Supprime définitivement une tâche. Seulement sur demande de l\'utilisateur ou pour une tâche créée par erreur.',
    inputSchema: { type: 'object', properties: { id: ID_SCHEMA }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

export interface ResultatOutil {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const jour = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/** Ce que Claude voit d'une tâche : l'essentiel, sans les champs vides. */
function vueTache(t: Tache) {
  return {
    id: t.id,
    projet: t.projet,
    titre: t.titre,
    statut: t.statut,
    ...(t.details ? { details: t.details } : {}),
    creeLe: jour(t.creeLe),
    ...(t.faiteLe === null ? {} : { faiteLe: jour(t.faiteLe) }),
  };
}

const vueProjet = (p: Projet) => ({ nom: p.nom, aFaire: p.aFaire, enCours: p.enCours, faites: p.faites });

const STATUTS_FILTRE: Record<string, readonly Statut[] | undefined> = {
  ouvertes: ['a_faire', 'en_cours'],
  a_faire: ['a_faire'],
  en_cours: ['en_cours'],
  faites: ['faite'],
  toutes: undefined,
};

function idDe(args: Record<string, unknown>): number {
  const id = args.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw validation('id : entier positif attendu.');
  return id;
}

const texte = (valeur: unknown): ResultatOutil => ({ content: [{ type: 'text', text: JSON.stringify(valeur, null, 2) }] });

export class OutilsMcp {
  constructor(private readonly taches: ServiceTaches) {}

  existe(nom: string): boolean {
    return OUTILS.some((o) => o.name === nom);
  }

  /** Une erreur métier (saisie invalide, tâche introuvable) revient à Claude comme résultat en erreur, qu'il peut corriger. */
  appeler(nom: string, args: Record<string, unknown>): ResultatOutil {
    try {
      return texte(this.executer(nom, args));
    } catch (erreur) {
      if (erreur instanceof ErreurMetier) return { content: [{ type: 'text', text: erreur.message }], isError: true };
      throw erreur;
    }
  }

  private executer(nom: string, args: Record<string, unknown>): unknown {
    switch (nom) {
      case 'lister_projets':
        return this.taches.projets().map(vueProjet);
      case 'lister_taches': {
        const statut = args.statut ?? 'ouvertes';
        if (typeof statut !== 'string' || !(statut in STATUTS_FILTRE)) {
          throw validation('statut : ouvertes, a_faire, en_cours, faites ou toutes.');
        }
        const statuts = STATUTS_FILTRE[statut];
        return this.taches
          .taches({ projet: args.projet, faitesMax: 20, ...(statuts === undefined ? {} : { statuts }) })
          .map(vueTache);
      }
      case 'creer_tache':
        return vueTache(this.taches.creerTache({ projet: args.projet, titre: args.titre, details: args.details, statut: args.statut }, 'claude'));
      case 'modifier_tache':
        return vueTache(
          this.taches.modifierTache(idDe(args), { projet: args.projet, titre: args.titre, details: args.details, statut: args.statut }),
        );
      case 'terminer_tache':
        return vueTache(this.taches.modifierTache(idDe(args), { statut: 'faite' }));
      case 'supprimer_tache': {
        const supprimee = this.taches.supprimerTache(idDe(args));
        return { supprimee: vueTache(supprimee) };
      }
      default:
        throw validation(`Outil inconnu : ${nom}.`);
    }
  }
}
