// Clés d'accès (WebAuthn) côté navigateur : traduit les options JSON du serveur pour navigator.credentials,
// et la réponse de l'appareil en JSON pour le serveur (format attendu par @simplewebauthn/server).
'use strict';

window.Cles = (() => {
  const versOctets = (b64url) => {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  };
  const versTexte = (tampon) => {
    let binaire = '';
    for (const octet of new Uint8Array(tampon)) binaire += String.fromCharCode(octet);
    return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const identifiants = (liste = []) => liste.map((c) => ({ ...c, id: versOctets(c.id) }));

  const disponible = () => typeof window.PublicKeyCredential === 'function';

  /** Messages lisibles pour les refus du navigateur. */
  function traduire(erreur) {
    if (erreur && erreur.name === 'NotAllowedError') return new Error('Opération annulée ou délai dépassé.');
    if (erreur && erreur.name === 'InvalidStateError') return new Error('Cet appareil a déjà une clé pour ce site.');
    if (erreur && erreur.name === 'SecurityError') return new Error('Clés d’accès indisponibles sur cette adresse (HTTPS requis).');
    return erreur instanceof Error ? erreur : new Error(String(erreur));
  }

  async function creer(options) {
    if (!disponible()) throw new Error('Ce navigateur ne gère pas les clés d’accès.');
    const publicKey = {
      ...options,
      challenge: versOctets(options.challenge),
      user: { ...options.user, id: versOctets(options.user.id) },
      excludeCredentials: identifiants(options.excludeCredentials),
    };
    let credential;
    try {
      credential = await navigator.credentials.create({ publicKey });
    } catch (erreur) {
      throw traduire(erreur);
    }
    const r = credential.response;
    return {
      id: credential.id,
      rawId: versTexte(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: versTexte(r.clientDataJSON),
        attestationObject: versTexte(r.attestationObject),
        transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
      },
    };
  }

  async function utiliser(options) {
    if (!disponible()) throw new Error('Ce navigateur ne gère pas les clés d’accès.');
    const publicKey = { ...options, challenge: versOctets(options.challenge), allowCredentials: identifiants(options.allowCredentials) };
    let credential;
    try {
      credential = await navigator.credentials.get({ publicKey });
    } catch (erreur) {
      throw traduire(erreur);
    }
    const r = credential.response;
    return {
      id: credential.id,
      rawId: versTexte(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: versTexte(r.clientDataJSON),
        authenticatorData: versTexte(r.authenticatorData),
        signature: versTexte(r.signature),
        userHandle: r.userHandle ? versTexte(r.userHandle) : undefined,
      },
    };
  }

  /** Nom proposé pour l'appareil, d'après le navigateur. */
  function nomProbable() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Téléphone Android';
    if (/Windows/.test(ua)) return 'PC Windows';
    if (/Mac OS X/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'PC Linux';
    return 'Appareil';
  }

  return { creer, utiliser, nomProbable };
})();
