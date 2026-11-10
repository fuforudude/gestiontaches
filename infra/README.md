# Mise en ligne : taches.pocharlumetravail.fr

Même VPS que Pocharlume et telechargements (`145.239.83.184`). Le serveur ne se configure jamais à la main.

## 1. DNS (chez OVH, une fois)
Zone `pocharlumetravail.fr` : `taches` en A vers `145.239.83.184` et en AAAA vers `2001:41d0:601:1100::8457`.

## 2. Préparer le serveur (rejouable)
```bash
ssh -i ~/.ssh/vps_ovh ubuntu@145.239.83.184 'sudo bash -s' < infra/vps/site-taches.sh
```
Utilisateur système `taches`, service systemd durci sur `127.0.0.1:3200`, code dans `/srv/taches/app`, données
dans `/var/lib/taches/taches.db`, commandes `taches-cle` et `taches-jeton`, nginx (le jeton MCP est masqué dans
les journaux).

## 3. Certificat HTTPS (une fois le DNS en place)
```bash
ssh -i ~/.ssh/vps_ovh ubuntu@145.239.83.184 'sudo certbot certonly --webroot -w /var/www/acme -d taches.pocharlumetravail.fr --non-interactive --deploy-hook "systemctl reload nginx"'
```
puis relancer l'étape 2, qui passe en HTTPS.

## 4. Déployer
```bash
bash infra/deployer.sh
```
Depuis le PC, avec la clé d'administration : `npm run verifier`, paquet de production, envoi, échange atomique
du dossier, redémarrage. (Pas de déploiement automatique par GitHub : `AllowUsers` de sshd ne connaît pas d'utilisateur
de déploiement pour ce projet, et ce réglage appartient à `Pocharlume/infra/vps/securiser.sh`.)

## 5. Clé d'accès et jeton
```bash
ssh -t -i ~/.ssh/vps_ovh ubuntu@145.239.83.184 sudo taches-cle
ssh -t -i ~/.ssh/vps_ovh ubuntu@145.239.83.184 sudo taches-jeton
```
`taches-cle` affiche un lien d'inscription (usage unique, 15 minutes) à ouvrir sur l'appareil à enregistrer : il y
crée une clé d'accès (passkey) et ouvre la session. Les appareils suivants s'ajoutent depuis le site (« Appareils »).
La commande reste le secours si tous les appareils sont perdus. Les clés sont liées au domaine : changer de domaine
impose de les recréer. `taches-jeton` affiche l'adresse MCP
une seule fois ; la relancer en crée une nouvelle et coupe l'ancienne.

## Sauvegarde
Tout l'état est dans `/var/lib/taches/taches.db`.
