// Clés d'accès : inscription par lien ou session, connexion, garde-fous WebAuthn, gestion des appareils.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connecterAppareil, cookieDe, creerBanc, inscrireAvecLien, jetonDuLien, nouvelAppareil, ORIGINE, type Banc } from './aide.js';

let banc: Banc;
beforeEach(async () => {
  banc = await creerBanc();
});
afterEach(() => {
  banc.fermer();
});

const MINUTE = 60 * 1000;
const nouveauLien = () => jetonDuLien(banc.acces.creerLienInscription());
const optionsConnexion = async () => (await (await banc.site('POST', '/connexion/options', {}, '')).json()) as { challenge: string };

describe('inscription par lien', () => {
  it('ouvre une session de 90 jours avec un cookie protégé et liste la clé', async () => {
    const reponse = await inscrireAvecLien(banc, nouvelAppareil(), nouveauLien(), 'iPhone');
    expect(reponse.status).toBe(201);
    const cookie = reponse.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toContain(new Date(banc.horloge.instant + 90 * 24 * 60 * MINUTE).toUTCString());

    const cles = (await (await banc.site('GET', '/cles', undefined, cookieDe(reponse))).json()) as { nom: string }[];
    expect(cles.map((c) => c.nom)).toEqual(['PC', 'iPhone']);
  });

  it('les options d\'inscription annoncent le site, exigent la vérification et excluent les clés existantes', async () => {
    const options = (await (await banc.site('POST', '/cles/options', { lien: nouveauLien() }, '')).json()) as {
      rp: { id: string };
      authenticatorSelection: { residentKey: string; userVerification: string };
      excludeCredentials: { id: string }[];
    };
    expect(options.rp.id).toBe('taches.exemple.test');
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([banc.appareil.id]);
  });

  it('un lien ne sert qu\'une fois', async () => {
    const lien = nouveauLien();
    expect((await inscrireAvecLien(banc, nouvelAppareil(), lien)).status).toBe(201);
    expect((await inscrireAvecLien(banc, nouvelAppareil(), lien)).status).toBe(401);
  });

  it('refuse un lien expiré, inventé ou absent', async () => {
    const lien = nouveauLien();
    banc.horloge.instant += 16 * MINUTE;
    expect((await banc.site('POST', '/cles/options', { lien }, '')).status).toBe(401);
    expect((await banc.site('POST', '/cles/options', { lien: 'x'.repeat(43) }, '')).status).toBe(401);
    expect((await banc.site('POST', '/cles/options', {}, '')).status).toBe(401);
    expect((await banc.site('POST', '/cles', { reponse: {} }, '')).status).toBe(401);
  });

  it('refuse une inscription sans vérification de l\'utilisateur, d\'une autre origine ou à défi rejoué', async () => {
    const lien = nouveauLien();
    const essai = async (opts: Parameters<ReturnType<typeof nouvelAppareil>['creer']>[1], defi?: string) => {
      const options = defi ? { challenge: defi } : ((await (await banc.site('POST', '/cles/options', { lien }, '')).json()) as { challenge: string });
      return banc.site('POST', '/cles', { lien, reponse: nouvelAppareil().creer(options, opts) }, '');
    };
    expect((await essai({ sansVerification: true })).status).toBe(401);
    expect((await essai({ origine: 'https://mechant.exemple' })).status).toBe(401);
    expect((await essai({ type: 'webauthn.get' })).status).toBe(401);
    // Le lien n'a pas été consommé par les échecs.
    const options = (await (await banc.site('POST', '/cles/options', { lien }, '')).json()) as { challenge: string };
    expect((await banc.site('POST', '/cles', { lien, reponse: nouvelAppareil().creer(options) }, '')).status).toBe(201);
    expect((await essai({}, options.challenge)).status).toBe(401);
  });

  it('valide la forme de la réponse et le nom', async () => {
    const lien = nouveauLien();
    expect((await banc.site('POST', '/cles', { lien, reponse: 'bof' }, '')).status).toBe(400);
    expect((await banc.site('POST', '/cles', { lien, reponse: { id: 1 } }, '')).status).toBe(400);
    expect((await banc.site('POST', '/cles', { lien, nom: 'n'.repeat(61), reponse: {} }, '')).status).toBe(400);
    expect((await banc.site('POST', '/cles', { lien, nom: 3, reponse: {} }, '')).status).toBe(400);
  });
});

describe('connexion', () => {
  it('connecte l\'appareil inscrit et note la dernière connexion', async () => {
    banc.horloge.instant += 60 * MINUTE;
    const reponse = await connecterAppareil(banc, banc.appareil);
    expect(reponse.status).toBe(200);
    const cookie = cookieDe(reponse);
    expect(await (await banc.site('GET', '/session', undefined, cookie)).json()).toEqual({ connecte: true });
    const [cle] = (await (await banc.site('GET', '/cles', undefined, cookie)).json()) as { utiliseeLe: number }[];
    expect(cle?.utiliseeLe).toBe(banc.horloge.instant);
  });

  it('les options de connexion demandent la vérification et laissent l\'appareil choisir sa clé', async () => {
    expect(await optionsConnexion()).toMatchObject({ rpId: 'taches.exemple.test', userVerification: 'required', allowCredentials: [] });
  });

  it('refuse une clé inconnue, un défi rejoué, expiré ou inventé, une autre origine', async () => {
    const statut = async (corps: unknown) => (await banc.site('POST', '/connexion', corps, '')).status;
    expect(await statut({ reponse: nouvelAppareil().utiliser(await optionsConnexion()) })).toBe(401);

    const options = await optionsConnexion();
    expect(await statut({ reponse: banc.appareil.utiliser(options) })).toBe(200);
    expect(await statut({ reponse: banc.appareil.utiliser(options) })).toBe(401);

    const vieilles = await optionsConnexion();
    banc.horloge.instant += 6 * MINUTE;
    expect(await statut({ reponse: banc.appareil.utiliser(vieilles) })).toBe(401);
    expect(await statut({ reponse: banc.appareil.utiliser({ challenge: 'invente' }) })).toBe(401);
    expect(await statut({ reponse: banc.appareil.utiliser(await optionsConnexion(), { origine: 'https://mechant.exemple' }) })).toBe(401);
    expect(await statut({ reponse: banc.appareil.utiliser(await optionsConnexion(), { sansVerification: true }) })).toBe(401);
    expect(await statut({ reponse: null })).toBe(400);
  });

  it('refuse une signature rejouée avec un compteur qui n\'avance pas (clé clonée)', async () => {
    expect((await connecterAppareil(banc, banc.appareil)).status).toBe(200);
    banc.appareil.compteur = 0;
    expect((await connecterAppareil(banc, banc.appareil)).status).toBe(401);
  });

  it('la déconnexion ferme la session', async () => {
    expect((await banc.site('POST', '/deconnexion')).status).toBe(200);
    expect((await banc.site('GET', '/etat')).status).toBe(401);
  });
});

describe('gestion des appareils', () => {
  it('ajoute une clé avec la session ouverte, sans nouvelle session', async () => {
    const options = (await (await banc.site('POST', '/cles/options', {})).json()) as { challenge: string };
    const reponse = await banc.site('POST', '/cles', { nom: '  Tablette  ', reponse: nouvelAppareil().creer(options) });
    expect(reponse.status).toBe(201);
    expect(reponse.headers.get('set-cookie')).toBeNull();
    expect(await reponse.json()).toMatchObject({ nom: 'Tablette' });
  });

  it('refuse d\'inscrire deux fois la même clé', async () => {
    const options = (await (await banc.site('POST', '/cles/options', {})).json()) as { challenge: string };
    expect((await banc.site('POST', '/cles', { reponse: banc.appareil.creer(options) })).status).toBe(409);
  });

  it('crée un lien pour un autre appareil, seulement connecté', async () => {
    const reponse = await banc.site('POST', '/cles/lien');
    expect(reponse.status).toBe(201);
    const { lien } = (await reponse.json()) as { lien: string };
    expect(lien.startsWith(`${ORIGINE}/?inscription=`)).toBe(true);
    expect((await inscrireAvecLien(banc, nouvelAppareil(), jetonDuLien(lien))).status).toBe(201);
    expect((await banc.site('POST', '/cles/lien', undefined, '')).status).toBe(401);
  });

  it('retire une clé mais jamais la dernière', async () => {
    expect((await banc.site('DELETE', `/cles/${banc.appareil.id}`)).status).toBe(409);
    const autre = nouvelAppareil();
    await inscrireAvecLien(banc, autre, nouveauLien());
    expect((await banc.site('DELETE', `/cles/${banc.appareil.id}`)).status).toBe(204);
    expect((await banc.site('DELETE', `/cles/${banc.appareil.id}`)).status).toBe(404);
    expect((await connecterAppareil(banc, banc.appareil)).status).toBe(401);
    expect((await connecterAppareil(banc, autre)).status).toBe(200);
  });

  it('la liste des clés exige une session', async () => {
    expect((await banc.site('GET', '/cles', undefined, '')).status).toBe(401);
  });
});
