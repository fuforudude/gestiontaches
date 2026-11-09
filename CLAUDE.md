# taches

Gestionnaire de tâches par projet sur taches.pocharlume.fr (VPS OVH partagé avec Pocharlume), avec serveur MCP
pour que Claude le tienne à jour. Dépôt : github.com/fuforudude/gestiontaches. Voir [README.md](README.md).

## Commandes
- Lancer : `npm run dev` (après `cp .env.exemple .env`)
- Tout vérifier : `npm run verifier`
- Déployer : `bash infra/deployer.sh` (vérifie, compile, envoie, redémarre)

## Conventions
- Tout en français : interface, code, commentaires, commits.
- Couches route → service → dépôt → domaine ; les routes ne font que du HTTP ou du JSON-RPC.
- Schéma dans `src/depots/base.ts` : une migration appliquée ne se réécrit jamais, on en ajoute une.
- Pas de dépendance native (le paquet construit sur le PC est copié tel quel sur le VPS).
- Config du serveur uniquement par `infra/vps/site-taches.sh`, jamais à la main.
- Toute modification des outils MCP garde leurs noms (les consignes globales de Claude les citent).
