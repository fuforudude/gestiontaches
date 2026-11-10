// Erreurs métier : les couches basses les lèvent, les routes les traduisent en réponses HTTP ou MCP.
export type CodeErreur = 'validation' | 'introuvable' | 'conflit' | 'non_connecte' | 'trop_gros' | 'origine_refusee';

export class ErreurMetier extends Error {
  constructor(
    readonly code: CodeErreur,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurMetier';
  }
}

export const validation = (message: string) => new ErreurMetier('validation', message);
export const introuvable = (message = 'Introuvable.') => new ErreurMetier('introuvable', message);
export const conflit = (message: string) => new ErreurMetier('conflit', message);
