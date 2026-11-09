# taches (dépôt gestiontaches)

Mes tâches rangées par projet, sur **taches.pocharlume.fr**. Claude les tient à jour tout seul grâce au serveur MCP
intégré (il crée, passe en cours et coche les tâches du travail qu'il fait) ; je les vois et les coche depuis le site,
sur PC comme sur téléphone.

## Ce que fait le site
- Liste des projets avec le nombre de tâches ouvertes ; vue « À faire », « Faites » ou « Tout ».
- Cocher / décocher, passer une tâche « en cours », modifier titre, détails et projet, supprimer.
- Ajouter une tâche ou un projet à la main. Les tâches créées par Claude portent la mention « par Claude ».
- La page se relit toute seule toutes les 15 s : ce que Claude change apparaît sans recharger.
- Un seul compte, connexion par mot de passe (5 échecs = 15 min de blocage), cookie de session protégé.

## Serveur MCP
Adresse : `https://taches.pocharlume.fr/mcp/<jeton>` (transport « Streamable HTTP », sans état). Le jeton se crée
sur le serveur avec `sudo taches-jeton`, qui affiche l'adresse complète une seule fois et révoque l'ancienne.
Le jeton peut aussi passer en en-tête `Authorization: Bearer <jeton>` sur `/mcp`.

Outils : `lister_projets`, `lister_taches`, `creer_tache`, `modifier_tache`, `terminer_tache`, `supprimer_tache`.
Le serveur envoie à Claude, à la connexion, des consignes sur la façon de tenir les tâches (`src/services/outils-mcp.ts`).

### Brancher Claude
- **claude.ai (web, appli de bureau, mobile)** : Paramètres → Connecteurs → Ajouter un connecteur personnalisé,
  nom « Tâches », URL = l'adresse ci-dessus. Il est alors disponible dans toutes les conversations.
- **Claude Code** : `claude mcp add --scope user --transport http taches <adresse>`.

## Développement
```bash
cp .env.exemple .env
npm install
npm run verifier   # types, lint, tests avec seuils de couverture
npm run dev        # http://localhost:3200
```

## Architecture
Node 22 + Hono, SQLite intégré à Node (`node:sqlite`), aucune dépendance native. Couches route → service → dépôt →
domaine ; le site (`routes-api.ts`) et le serveur MCP (`routes-mcp.ts`) passent par le même `ServiceTaches`.
Page sans framework dans `public/`. Mise en ligne : voir [infra/README.md](infra/README.md).
