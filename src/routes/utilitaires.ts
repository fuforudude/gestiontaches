import type { Context } from 'hono';
import { introuvable, validation } from '../domaine/erreurs.js';

/** Un identifiant mal formé est traité comme une ressource absente. */
export function idDepuis(texte: string | undefined): number {
  const id = Number(texte);
  if (!Number.isSafeInteger(id) || id <= 0) throw introuvable();
  return id;
}

export async function lireJson(c: Context): Promise<Record<string, unknown>> {
  let corps: unknown;
  try {
    corps = await c.req.json();
  } catch {
    throw validation('Corps JSON attendu.');
  }
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) throw validation('Objet JSON attendu.');
  return corps as Record<string, unknown>;
}
