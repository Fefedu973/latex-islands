# Mesures historiques du moteur TikZ — v1.2

Mesure unique conservée comme point de comparaison. Ces résultats ne sont pas des mesures de la v1.4 ni une garantie de performance.

## Environnement et méthode

- Poste de développement Windows 11, 64 bits.
- Node.js v22.16.0, moteur TikZJax 1.6.0 fourni avec l’extension.
- Vrai WebAssembly et vrais fichiers TeX embarqués. Le test adapte uniquement les événements Worker et les lectures locales de fichiers aux API Node.js ; aucun service de compilation ni accès réseau extérieur.
- Une exécution locale, sans médiane statistique ni garantie sur d’autres machines. Les temps ci-dessous ne comprennent pas les messages Chrome, le chargement de l’iframe, la conversion SVG en DOM, les polices ou la peinture du navigateur.

Reproduction depuis le dossier de l’extension :

```sh
node tests/engine.test.cjs
node tests/compiler.test.cjs
node --test tests/runtime.test.cjs
```

## Départ froid, préchauffage et cache

Le test `compiler.test.cjs` compile un cercle TikZ avec une formule, arrête son worker, vide son cache SVG, préchauffe un nouveau worker et recompile exactement la même source. Les SVG obtenus sont identiques. Il mesure ensuite une consultation du cache SVG.

| Étape | Durée observée |
| --- | ---: |
| Première compilation avec worker froid | 962 ms |
| Dont chargement du moteur | 801 ms |
| Préchauffage séparé du nouveau worker | 778 ms |
| Compilation après ce préchauffage | 145 ms |
| Consultation du cache SVG | 0,008 ms |

Le préchauffage déplace le chargement du moteur dans la période où ChatGPT écrit encore le bloc. Il ne supprime pas ce travail. Pour cette exécution, l’attente de compilation après disponibilité du code passe de 962 à 145 ms si le préchauffage a pu se terminer pendant le streaming.

Sortie exacte du benchmark :

```json
{"coldMs":962,"coldLoadMs":801,"prewarmMs":778,"afterPrewarmMs":145,"cachedMs":0.008}
```

## Coûts restants

La suite compiler a notamment observé les durées suivantes, hors attente dans la file :

| Exemple | Durée observée |
| --- | ---: |
| Circuitikz automatique | 1 332 ms |
| Axe PGFPlots automatique | 1 358 ms |
| Circuit complexe | 1 500 ms |
| Graphe en 3D | 234 ms |
| Organigramme avec bibliothèques inférées | 423 ms |
| Molécule Chemfig | 817 ms |
| Surface PGFPlots 3D | 6 337 ms |
| Exemple de surface 3D | 5 646 ms |
| Schéma valide après une erreur TeX, même worker conservé | 95 ms |

Les surfaces complexes restent coûteuses à calculer. Le préchauffage agit sur le démarrage, tandis que la conservation du worker préserve aussi les fichiers de bibliothèques déjà décompressés. Les erreurs internes, sorties SVG invalides et dépassements de délai provoquent toujours la destruction du worker.

La suite vérifie également une véritable boucle TeX infinie, sa terminaison forcée et la réussite d’une compilation avec un nouveau worker après ce dépassement.

## Optimisations couvertes par les tests de transport

- Un préchauffage simultané de plusieurs îlots ne charge qu’un worker et ne compile aucun code incomplet.
- Les demandes identiques en cours partagent leur résultat, sans remplir les 24 places de la file ni attendre derrière d’autres schémas.
- Les résultats restent en cache après l’expiration du worker ; les éléments récemment consultés sont conservés en priorité.
- Le cache est limité à 24 résultats et à environ 20 Mio de chaînes source/SVG, selon une estimation de deux octets par caractère ; cette estimation ne représente pas toute la mémoire JavaScript.
- Le worker expire après 90 secondes sans compilation ni nouveau préchauffage.
