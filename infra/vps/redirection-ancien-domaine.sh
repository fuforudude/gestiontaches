#!/usr/bin/env bash
# Redirige les anciens noms des outils (taches. et telechargements. sur pocharlume.fr) vers pocharlumetravail.fr, chemin conservé.
# À lancer en root : ssh … 'sudo bash -s' < infra/vps/redirection-ancien-domaine.sh. Rejouable sans risque.
# Chaque ancien nom garde son certificat Let's Encrypt (renouvelé tant que le DNS de l'ancien domaine pointe ici) :
# sans certificat, il n'est redirigé qu'en HTTP. À supprimer (rm /etc/nginx/sites-enabled/ancien-domaine) quand
# l'ancien domaine n'est plus renouvelé.
# Le jeu (pocharlume.fr, www, travail) n est PAS concerné : il migrera plus tard vers pocharlume.pocharlumetravail.fr.
set -euo pipefail

NOUVEAU=pocharlumetravail.fr
ANCIEN=pocharlume.fr
# ancien nom : nouveau nom
NOMS="taches.$ANCIEN:taches.$NOUVEAU telechargements.$ANCIEN:telechargements.$NOUVEAU"

CONF=/tmp/ancien-domaine.conf.$$
: > "$CONF"
for paire in $NOMS; do
  vieux=${paire%%:*}; neuf=${paire##*:}
  # www.pocharlume.fr n'a pas son propre certificat : il partage celui de pocharlume.fr.
  cert=/etc/letsencrypt/live/${vieux#www.}
  cat >> "$CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $vieux;
    include snippets/pocharlume-acme.conf;
    location / { return 301 https://$neuf\$request_uri; }
}
EOF
  if [ -e "$cert/fullchain.pem" ]; then
    echo "   $vieux : certificat présent, redirection HTTPS"
    cat >> "$CONF" <<EOF
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $vieux;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    include snippets/pocharlume-tls.conf;
    return 301 https://$neuf\$request_uri;
}
EOF
  else
    echo "   $vieux : pas de certificat, redirection HTTP seule"
  fi
done

install -m 644 "$CONF" /etc/nginx/sites-available/ancien-domaine
rm -f "$CONF"
ln -sf /etc/nginx/sites-available/ancien-domaine /etc/nginx/sites-enabled/ancien-domaine
if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/ancien-domaine
  echo 'nginx -t a échoué : redirection retirée'
  exit 1
fi
systemctl reload nginx
echo '== Fait'
