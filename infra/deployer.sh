#!/usr/bin/env bash
# Déploie la version courante sur le VPS depuis le PC : vérification, compilation, paquet de production, envoi, redémarrage.
#   bash infra/deployer.sh
# Utilise la clé d'administration ~/.ssh/vps_ovh. Refuse de déployer un état qui ne passe pas `npm run verifier`.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS=ubuntu@145.239.83.184
CLE=~/.ssh/vps_ovh
APP=/srv/taches/app

npm run verifier
npm run build

PAQUET=$(mktemp -d)
trap 'rm -rf "$PAQUET"' EXIT
cp -r dist public package.json package-lock.json "$PAQUET/"
# Aucune dépendance native : les modules installés sur le PC tournent tels quels sur le serveur.
(cd "$PAQUET" && npm ci --omit=dev --ignore-scripts --silent)
git rev-parse --short HEAD > "$PAQUET/VERSION" 2>/dev/null || echo inconnue > "$PAQUET/VERSION"

# Le nouveau code est déballé à côté puis échangé d'un coup : jamais de code à moitié à jour.
tar -C "$PAQUET" -czf - . | ssh -i "$CLE" -o BatchMode=yes "$VPS" "sudo bash -c '
  set -e
  rm -rf $APP.nouveau && mkdir -p $APP.nouveau
  tar -xzf - -C $APP.nouveau --no-same-owner
  chown -R root:root $APP.nouveau && chmod -R u=rwX,go=rX $APP.nouveau
  rm -rf $APP.ancien
  if [ -d $APP ]; then mv $APP $APP.ancien; fi
  mv $APP.nouveau $APP
  systemctl restart taches.service
  sleep 1
  systemctl is-active taches.service
'"
echo "Déployé : $(cat "$PAQUET/VERSION")"
