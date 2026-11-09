#!/usr/bin/env bash
# Site taches.pocharlume.fr sur le VPS : utilisateur et dossiers, service systemd, commandes, nginx.
# À lancer en root : ssh -i ~/.ssh/vps_ovh ubuntu@145.239.83.184 'sudo bash -s' < infra/vps/site-taches.sh
# Rejouable sans risque. Suppose le serveur préparé par Pocharlume/infra/vps/securiser.sh et site-pocharlume.sh
# (nginx, certbot, snippets pocharlume-tls et pocharlume-acme) et Node >= 22.13 (installé pour telechargements).
# Sans certificat, le site est servi en HTTP seul ; une fois le certificat obtenu (voir infra/README.md),
# relancer ce script passe en HTTPS.
set -euo pipefail

DOMAINE=taches.pocharlume.fr
APP=/srv/taches/app
DONNEES=/var/lib/taches
PORT=3200
CERT=/etc/letsencrypt/live/$DOMAINE

ecrire() { cat > "$1"; chmod 644 "$1"; }

for f in /etc/nginx/snippets/pocharlume-tls.conf /etc/nginx/snippets/pocharlume-acme.conf; do
  [ -e "$f" ] || { echo "Manque $f : lancer d'abord Pocharlume/infra/vps/site-pocharlume.sh"; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Node >= 22.13 requis (node:sqlite)"); process.exit(1) }'

echo '== Utilisateur taches : propriétaire des données, sans connexion'
id taches >/dev/null 2>&1 || useradd --system --home-dir "$DONNEES" --no-create-home --shell /usr/sbin/nologin taches

echo '== Dossiers'
# Le code appartient à root (déposé par infra/deployer.sh) ; le service ne fait que le lire.
install -d -m 755 /srv/taches "$APP"
install -d -m 700 -o taches -g taches "$DONNEES"

echo '== Service systemd'
ecrire /etc/systemd/system/taches.service <<EOF
[Unit]
Description=Mes tâches ($DOMAINE)
After=network.target
# Avant le premier déploiement, il n'y a rien à lancer.
ConditionPathExists=$APP/dist/serveur.js

[Service]
User=taches
Group=taches
WorkingDirectory=$APP
Environment=NODE_ENV=production PORT=$PORT DOSSIER_DONNEES=$DONNEES ORIGINE=https://$DOMAINE
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning dist/serveur.js
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DONNEES
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable taches.service
if [ -e "$APP/dist/serveur.js" ]; then systemctl restart taches.service; fi

echo '== Commandes taches-admin (compte du site) et taches-jeton (adresse du serveur MCP)'
for outil in admin jeton; do
  ecrire /usr/local/bin/taches-$outil <<EOF
#!/bin/sh
cd $APP && exec sudo -u taches env DOSSIER_DONNEES=$DONNEES ORIGINE=https://$DOMAINE \\
  /usr/bin/node --disable-warning=ExperimentalWarning dist/outils/$outil.js "\$@"
EOF
  chmod 755 /usr/local/bin/taches-$outil
done

echo '== nginx'
ecrire /etc/nginx/snippets/taches-proxy.conf <<EOF
proxy_pass http://127.0.0.1:$PORT;
proxy_http_version 1.1;
proxy_set_header Host \$host;
# Le service n'écoute que sur 127.0.0.1 : cet en-tête, posé ici, est la seule source de l'adresse du visiteur.
proxy_set_header X-Real-IP \$remote_addr;
proxy_set_header X-Forwarded-For "";
EOF
# Contexte http : limitation des connexions, journal qui masque le jeton MCP contenu dans /mcp/<jeton>.
ecrire /etc/nginx/conf.d/taches.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=taches_connexion:1m rate=10r/m;
map $request_uri $taches_uri {
    ~^/mcp/[^/?]+(?<reste>.*)$ /mcp/***$reste;
    default $request_uri;
}
log_format taches '$remote_addr - [$time_local] "$request_method $taches_uri" $status $body_bytes_sent "$http_user_agent"';
EOF
SITE=$(cat <<EOF
    charset utf-8;
    # Les en-têtes de sécurité (HSTS compris) viennent de Node.
    client_max_body_size 64k;
    gzip on;
    gzip_types text/css text/javascript application/json;
    access_log /var/log/nginx/taches.log taches;

    location / {
        include snippets/taches-proxy.conf;
    }
    location = /api/connexion {
        limit_req zone=taches_connexion burst=5 nodelay;
        include snippets/taches-proxy.conf;
    }
EOF
)
if [ -e "$CERT/fullchain.pem" ]; then
  echo "   certificat présent : HTTPS"
  ecrire /etc/nginx/sites-available/taches <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;
    include snippets/pocharlume-acme.conf;
    location / { return 301 https://$DOMAINE\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAINE;
    ssl_certificate $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    include snippets/pocharlume-tls.conf;
$SITE
}
EOF
else
  echo "   pas encore de certificat : HTTP seul (la connexion au site attend HTTPS)"
  ecrire /etc/nginx/sites-available/taches <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;
    include snippets/pocharlume-acme.conf;
$SITE
}
EOF
fi
ln -sf /etc/nginx/sites-available/taches /etc/nginx/sites-enabled/taches
nginx -t
systemctl reload nginx

echo '== Fait'
