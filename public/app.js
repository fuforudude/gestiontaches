// Page des tâches : connexion, projets, tâches à cocher. Relit l'état régulièrement pour montrer ce que Claude a changé.
// Tout le texte venant de la base passe par textContent : jamais de HTML construit à partir des données.
'use strict';

const RELECTURE_MS = 15000;
const etat = { projets: [], taches: [], filtre: 'ouvertes', projet: null, edition: null };
let minuteurMessage;

const $ = (id) => document.getElementById(id);

function el(balise, attributs = {}, ...enfants) {
  const noeud = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur === null || valeur === undefined) continue;
    if (nom.startsWith('on')) noeud.addEventListener(nom.slice(2), valeur);
    else if (nom === 'texte') noeud.textContent = valeur;
    else noeud.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants) if (enfant !== null && enfant !== undefined && enfant !== false) noeud.append(enfant);
  return noeud;
}

function message(texte, erreur = false) {
  const zone = $('message');
  zone.textContent = texte;
  zone.classList.toggle('erreur', erreur);
  zone.classList.add('visible');
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => zone.classList.remove('visible'), 3500);
}

async function api(methode, chemin, corps) {
  const reponse = await fetch(`/api${chemin}`, {
    method: methode,
    headers: corps === undefined ? {} : { 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  if (reponse.status === 401 && !['/connexion', '/cles', '/cles/options'].includes(chemin)) {
    afficherConnexion();
    throw new Error('Connexion requise.');
  }
  if (reponse.status === 204) return null;
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.erreur || `Erreur ${reponse.status}`);
  return donnees;
}

/** Lance une action ; en cas d'échec, affiche le message et relit l'état. */
async function agir(travail) {
  try {
    await travail();
  } catch (erreur) {
    message(erreur.message, true);
  }
  await recharger();
}

async function recharger() {
  try {
    const donnees = await api('GET', '/etat');
    etat.projets = donnees.projets;
    etat.taches = donnees.taches;
    if (etat.projet !== null && !etat.projets.some((p) => p.id === etat.projet)) etat.projet = null;
    afficher();
  } catch {
    /* déjà signalé (connexion) ou réseau momentanément absent : la prochaine relecture réessaiera */
  }
}

function afficherConnexion() {
  $('appli').hidden = true;
  $('connexion').hidden = false;
  $('bouton-connexion').focus();
}

function afficherAppli() {
  $('connexion').hidden = true;
  $('appli').hidden = false;
}

// --- Affichage ----------------------------------------------------------------------------------

const correspondFiltre = (t) =>
  etat.filtre === 'toutes' || (etat.filtre === 'faites' ? t.statut === 'faite' : t.statut !== 'faite');

function dateCourte(instant) {
  return new Date(instant).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function afficher() {
  for (const bouton of document.querySelectorAll('[data-filtre]')) {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.filtre === etat.filtre));
  }
  afficherProjets();
  afficherTaches();
}

function afficherProjets() {
  const liste = $('liste-projets');
  const ouvertes = (p) => p.aFaire + p.enCours;
  const total = etat.projets.reduce((s, p) => s + ouvertes(p), 0);
  const entree = (id, nom, nombre) =>
    el(
      'li',
      {},
      el(
        'button',
        { type: 'button', 'aria-current': etat.projet === id ? 'true' : false, onclick: () => choisirProjet(id) },
        el('span', { texte: nom }),
        el('span', { class: 'compte', texte: nombre ? String(nombre) : '' }),
      ),
    );
  liste.replaceChildren(entree(null, 'Tous les projets', total), ...etat.projets.map((p) => entree(p.id, p.nom, ouvertes(p))));
}

function choisirProjet(id) {
  etat.projet = id;
  afficher();
}

function afficherTaches() {
  const contenu = $('contenu');
  // Une tâche en cours de modification n'est pas redessinée sous les doigts.
  if (etat.edition !== null && contenu.querySelector('.edition')) return;
  const projets = etat.projet === null ? etat.projets : etat.projets.filter((p) => p.id === etat.projet);
  const sections = projets
    .map((p) => sectionProjet(p, etat.taches.filter((t) => t.projetId === p.id && correspondFiltre(t))))
    .filter((s) => s !== null);
  if (sections.length === 0) {
    const vide = etat.projets.length === 0
      ? 'Aucun projet pour l’instant. Claude en créera en travaillant, ou ajoute-en un à gauche.'
      : etat.filtre === 'faites' ? 'Rien de coché ici pour l’instant.' : 'Tout est fait. 🎉';
    contenu.replaceChildren(el('p', { class: 'vide', texte: vide }));
    return;
  }
  contenu.replaceChildren(...sections);
}

function sectionProjet(projet, taches) {
  // En vue « tous les projets », un projet sans tâche visible est masqué, sauf s'il n'a encore aucune tâche.
  const seul = etat.projet !== null;
  const nombreTotal = projet.aFaire + projet.enCours + projet.faites;
  if (!seul && taches.length === 0 && nombreTotal > 0) return null;

  const titre = el(
    'div',
    { class: 'titre-projet' },
    el('h2', { texte: projet.nom }),
    el(
      'span',
      { class: 'outils-projet' },
      el('button', { type: 'button', class: 'icone', title: 'Renommer le projet', 'aria-label': 'Renommer le projet', texte: '✎', onclick: () => renommerProjet(projet) }),
      el('button', { type: 'button', class: 'icone', title: 'Supprimer le projet', 'aria-label': 'Supprimer le projet', texte: '🗑', onclick: () => supprimerProjet(projet) }),
    ),
  );
  const liste = el('ul', { class: 'taches' }, ...taches.map(ligneTache));
  const ajout = el(
    'form',
    {
      class: 'ajout-tache',
      onsubmit: (e) => {
        e.preventDefault();
        const champ = e.target.elements.titre;
        const valeur = champ.value.trim();
        if (!valeur) return;
        champ.value = '';
        void agir(() => api('POST', '/taches', { projet: projet.nom, titre: valeur }));
      },
    },
    el('input', { name: 'titre', placeholder: 'Ajouter une tâche…', maxlength: '200', 'aria-label': `Ajouter une tâche à ${projet.nom}` }),
  );
  return el('section', { class: 'projet' }, titre, liste, etat.filtre === 'faites' ? null : ajout);
}

function ligneTache(t) {
  if (etat.edition === t.id) return ligneEdition(t);
  const faite = t.statut === 'faite';
  const case_ = el('input', {
    type: 'checkbox',
    checked: faite,
    'aria-label': faite ? `Décocher « ${t.titre} »` : `Cocher « ${t.titre} »`,
    onchange: (e) => void agir(() => api('PATCH', `/taches/${t.id}`, { statut: e.target.checked ? 'faite' : 'a_faire' })),
  });
  const statut = faite
    ? el('span', { class: 'meta', texte: t.faiteLe ? `faite le ${dateCourte(t.faiteLe)}` : 'faite' })
    : el('button', {
        type: 'button',
        class: t.statut === 'en_cours' ? 'pastille en-cours' : 'pastille',
        title: t.statut === 'en_cours' ? 'Repasser en « à faire »' : 'Passer en cours',
        texte: t.statut === 'en_cours' ? 'En cours' : 'À faire',
        onclick: () => void agir(() => api('PATCH', `/taches/${t.id}`, { statut: t.statut === 'en_cours' ? 'a_faire' : 'en_cours' })),
      });
  return el(
    'li',
    { class: `tache${faite ? ' faite' : ''}${t.statut === 'en_cours' ? ' active' : ''}` },
    case_,
    el(
      'div',
      { class: 'corps' },
      el('span', { class: 'titre', texte: t.titre }),
      t.details ? el('p', { class: 'details', texte: t.details }) : null,
      el('span', { class: 'ligne-meta' }, statut, t.source === 'claude' ? el('span', { class: 'meta source', texte: 'par Claude' }) : null),
    ),
    el(
      'span',
      { class: 'outils' },
      el('button', { type: 'button', class: 'icone', title: 'Modifier', 'aria-label': 'Modifier', texte: '✎', onclick: () => editer(t.id) }),
      el('button', {
        type: 'button',
        class: 'icone',
        title: 'Supprimer',
        'aria-label': 'Supprimer',
        texte: '×',
        onclick: () => {
          if (confirm(`Supprimer « ${t.titre} » ?`)) void agir(() => api('DELETE', `/taches/${t.id}`));
        },
      }),
    ),
  );
}

function ligneEdition(t) {
  const fermer = () => {
    etat.edition = null;
    afficher();
  };
  const formulaire = el(
    'form',
    {
      class: 'edition',
      onsubmit: (e) => {
        e.preventDefault();
        const champs = e.target.elements;
        etat.edition = null;
        void agir(() => api('PATCH', `/taches/${t.id}`, { titre: champs.titre.value, details: champs.details.value, projet: champs.projet.value }));
      },
      onkeydown: (e) => {
        if (e.key === 'Escape') fermer();
      },
    },
    el('input', { name: 'titre', value: t.titre, maxlength: '200', required: true, 'aria-label': 'Titre' }),
    el('textarea', { name: 'details', rows: '3', maxlength: '4000', placeholder: 'Détails', 'aria-label': 'Détails', texte: t.details }),
    el(
      'select',
      { name: 'projet', 'aria-label': 'Projet' },
      ...etat.projets.map((p) => el('option', { value: p.nom, selected: p.id === t.projetId, texte: p.nom })),
    ),
    el(
      'span',
      { class: 'actions' },
      el('button', { type: 'submit', texte: 'Enregistrer' }),
      el('button', { type: 'button', class: 'discret', texte: 'Annuler', onclick: fermer }),
    ),
  );
  return el('li', { class: 'tache' }, formulaire);
}

function editer(id) {
  etat.edition = id;
  afficher();
  $('contenu').querySelector('.edition input')?.focus();
}

function renommerProjet(projet) {
  const nom = prompt('Nouveau nom du projet', projet.nom);
  if (nom === null || nom.trim() === '' || nom.trim() === projet.nom) return;
  void agir(() => api('PATCH', `/projets/${projet.id}`, { nom }));
}

function supprimerProjet(projet) {
  const nombre = projet.aFaire + projet.enCours + projet.faites;
  const detail = nombre ? ` et ses ${nombre} tâche${nombre > 1 ? 's' : ''}` : '';
  if (!confirm(`Supprimer le projet « ${projet.nom} »${detail} ? C'est définitif.`)) return;
  void agir(() => api('DELETE', `/projets/${projet.id}`));
}

// --- Démarrage ----------------------------------------------------------------------------------

// --- Clés d'accès ---------------------------------------------------------------------------------

const lienInscription = new URLSearchParams(location.search).get('inscription');

$('bouton-connexion').addEventListener('click', async () => {
  const bouton = $('bouton-connexion');
  $('erreur-connexion').textContent = '';
  bouton.disabled = true;
  try {
    const options = await api('POST', '/connexion/options', {});
    await api('POST', '/connexion', { reponse: await Cles.utiliser(options) });
    afficherAppli();
    await recharger();
  } catch (erreur) {
    $('erreur-connexion').textContent = erreur.message;
  } finally {
    bouton.disabled = false;
  }
});

$('form-inscription').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bouton = e.target.querySelector('button');
  $('erreur-inscription').textContent = '';
  bouton.disabled = true;
  try {
    const options = await api('POST', '/cles/options', { lien: lienInscription });
    const reponse = await Cles.creer(options);
    await api('POST', '/cles', { lien: lienInscription, nom: e.target.elements.nom.value, reponse });
    // Le lien est consommé : on le retire de l'adresse pour qu'un rechargement ne le redemande pas.
    history.replaceState(null, '', '/');
    $('inscription').hidden = true;
    afficherAppli();
    message('Clé d’accès créée : cet appareil se connecte maintenant sans mot de passe.');
    await recharger();
  } catch (erreur) {
    $('erreur-inscription').textContent = erreur.message;
  } finally {
    bouton.disabled = false;
  }
});

function dateLongue(instant) {
  return new Date(instant).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function afficherCles() {
  const cles = await api('GET', '/cles');
  $('liste-cles').replaceChildren(
    ...cles.map((c) =>
      el(
        'li',
        {},
        el(
          'span',
          { class: 'corps' },
          el('span', { class: 'titre', texte: c.nom }),
          el('span', { class: 'meta', texte: `ajoutée le ${dateLongue(c.creeLe)}${c.utiliseeLe ? ` · dernière connexion le ${dateLongue(c.utiliseeLe)}` : ''}` }),
        ),
        el('button', {
          type: 'button',
          class: 'icone',
          title: 'Retirer cette clé',
          'aria-label': `Retirer la clé « ${c.nom} »`,
          texte: '×',
          onclick: async () => {
            if (!confirm(`Retirer la clé « ${c.nom} » ? Cet appareil ne pourra plus se connecter.`)) return;
            try {
              await api('DELETE', `/cles/${encodeURIComponent(c.id)}`);
            } catch (erreur) {
              message(erreur.message, true);
            }
            await afficherCles();
          },
        }),
      ),
    ),
  );
}

$('ouvrir-appareils').addEventListener('click', async () => {
  $('zone-lien').hidden = true;
  $('appareils').showModal();
  await afficherCles().catch((erreur) => message(erreur.message, true));
});
$('fermer-appareils').addEventListener('click', () => $('appareils').close());

$('ajouter-cet-appareil').addEventListener('click', async () => {
  try {
    const options = await api('POST', '/cles/options', {});
    const reponse = await Cles.creer(options);
    const nom = prompt('Nom de cet appareil', Cles.nomProbable());
    await api('POST', '/cles', { nom: nom ?? '', reponse });
    message('Clé ajoutée pour cet appareil.');
    await afficherCles();
  } catch (erreur) {
    message(erreur.message, true);
  }
});

$('lien-autre-appareil').addEventListener('click', async () => {
  try {
    const { lien } = await api('POST', '/cles/lien');
    $('lien-genere').value = lien;
    $('zone-lien').hidden = false;
    $('lien-genere').select();
  } catch (erreur) {
    message(erreur.message, true);
  }
});

$('copier-lien').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('lien-genere').value);
    message('Lien copié.');
  } catch {
    $('lien-genere').select();
  }
});

$('deconnexion').addEventListener('click', async () => {
  await api('POST', '/deconnexion').catch(() => null);
  afficherConnexion();
});

$('form-projet').addEventListener('submit', (e) => {
  e.preventDefault();
  const champ = e.target.elements.nom;
  const nom = champ.value.trim();
  if (!nom) return;
  champ.value = '';
  void agir(async () => {
    const projet = await api('POST', '/projets', { nom });
    etat.projet = projet.id;
  });
});

for (const bouton of document.querySelectorAll('[data-filtre]')) {
  bouton.addEventListener('click', () => {
    etat.filtre = bouton.dataset.filtre;
    afficher();
  });
}

setInterval(() => {
  if (document.visibilityState === 'visible' && !$('appli').hidden) void recharger();
}, RELECTURE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('appli').hidden) void recharger();
});

(async () => {
  if (lienInscription) {
    $('form-inscription').elements.nom.value = Cles.nomProbable();
    $('inscription').hidden = false;
    return;
  }
  const { connecte } = await api('GET', '/session').catch(() => ({ connecte: false }));
  if (!connecte) return afficherConnexion();
  afficherAppli();
  await recharger();
})();
