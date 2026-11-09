// Hachage des mots de passe par scrypt (node:crypto). Format stocké : scrypt$N$r$p$sel$empreinte (base64).
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMETRES = { N: 2 ** 15, r: 8, p: 1 };
const LONGUEUR = 64;

function deriver(motDePasse: string, sel: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    scrypt(motDePasse, sel, LONGUEUR, { ...options, maxmem: 128 * 1024 * 1024 }, (erreur, cle) => {
      if (erreur) rejeter(erreur);
      else resoudre(cle);
    });
  });
}

export async function hacher(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await deriver(motDePasse, sel, PARAMETRES);
  const { N, r, p } = PARAMETRES;
  return `scrypt$${N}$${r}$${p}$${sel.toString('base64')}$${cle.toString('base64')}`;
}

export async function verifier(motDePasse: string, stocke: string): Promise<boolean> {
  const [algo, n, r, p, sel, empreinte] = stocke.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !sel || !empreinte) return false;
  const attendu = Buffer.from(empreinte, 'base64');
  const cle = await deriver(motDePasse, Buffer.from(sel, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return cle.length === attendu.length && timingSafeEqual(cle, attendu);
}

/** Pour un identifiant inconnu : on vérifie quand même, pour que la durée ne trahisse pas son absence. */
export const HACHE_LEURRE = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(LONGUEUR).toString('base64');
