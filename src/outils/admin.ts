// Crée le compte du site ou change son mot de passe. À lancer sur le serveur :
//   sudo taches-admin <identifiant>
// Le mot de passe se tape deux fois, sans s'afficher.
import path from 'node:path';
import { createInterface } from 'node:readline';
import { lireConfig } from '../config.js';
import { ouvrirBase } from '../depots/base.js';
import { DepotAcces } from '../depots/depot-acces.js';
import { ServiceAcces } from '../services/service-acces.js';

function demanderCache(question: string): Promise<string> {
  return new Promise((resoudre) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Rien n'est renvoyé à l'écran pendant la saisie.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
    process.stdout.write(question);
    rl.question('', (reponse) => {
      rl.close();
      process.stdout.write('\n');
      resoudre(reponse);
    });
  });
}

const identifiant = process.argv[2];
if (!identifiant) {
  console.error('Usage : taches-admin <identifiant>');
  process.exit(1);
}

const config = lireConfig(process.env);
const motDePasse = await demanderCache('Mot de passe : ');
if ((await demanderCache('Encore une fois : ')) !== motDePasse) {
  console.error('Les deux saisies diffèrent.');
  process.exit(1);
}
const base = ouvrirBase(path.join(config.dossierDonnees, 'taches.db'));
try {
  await new ServiceAcces(new DepotAcces(base), Date.now).definirAdmin(identifiant, motDePasse);
  console.log(`Compte « ${identifiant} » enregistré. Les sessions ouvertes sont fermées.`);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
} finally {
  base.close();
}
