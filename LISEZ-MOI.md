# LaTeX Islands — TikZ & Export for ChatGPT

Extension Chrome et Firefox desktop Manifest V3 · **Version 1.4.1** · Interface anglaise

Affiche des schémas TikZ dans les réponses ChatGPT, avec une interface inspirée de ses diagrammes natifs : aperçu intégré, zoom, déplacement et éditeur plein écran. Les formules, le Markdown et Mermaid restent affichés par ChatGPT. Le popup et l’éditeur utilisent une interface monochrome. L’export de conversation propose un transcript configurable et un aperçu, à partir des données JSON du site.

## Installation et mise à jour

Chrome 116 ou ultérieur est requis pour le paquet Chrome. Le paquet Firefox requiert Firefox desktop 140 ou ultérieur. Aucune commande, aucun serveur et aucune installation de TeX Live, Python ou Node ne sont nécessaires pour utiliser l’extension.

### Première installation

1. Décompresser entièrement le ZIP **Chrome v1.4.1** dans un dossier permanent.
2. Ouvrir `chrome://extensions` et activer **Mode développeur**.
3. Cliquer sur **Charger l’extension non empaquetée**.
4. Choisir le dossier décompressé qui contient directement `manifest.json`.
5. Recharger les onglets ChatGPT déjà ouverts.

Conserver ce dossier : Chrome y lit les fichiers de l’extension. Le ZIP ne s’installe pas par double-clic.

### Si une version précédente est déjà chargée

Mettre à jour les fichiers dans le dossier déjà utilisé par Chrome, puis cliquer sur **Actualiser** sur la carte de l’extension dans `chrome://extensions` et recharger ChatGPT. Le dossier peut garder son ancien nom ; la version effective est celle du `manifest.json`.

Pour utiliser un nouveau dossier décompressé, désactiver l’ancienne copie puis charger le nouveau dossier contenant `manifest.json`. Éviter de garder deux copies actives sur le même site.

### Firefox : installation de développement

Construire le paquet Firefox avec `npm ci` puis `npm run build` depuis le dépôt. Dans `about:debugging#/runtime/this-firefox`, choisir **Charger un module complémentaire temporaire** et sélectionner `dist/firefox/manifest.json`. Cette installation disparaît à la fermeture de Firefox. Une installation persistante normale nécessite un paquet signé par Mozilla ; aucune disponibilité en boutique n’est annoncée tant que le lien réel n’existe pas. Voir [README.md](README.md) pour les builds Chrome/Firefox et [PRIVACY.md](PRIVACY.md) pour les déclarations de données.

## Schémas dans ChatGPT

L’extension reconnaît notamment `tikzpicture`, `circuitikz`, `axis`, `tikzcd`, `\chemfig` et les constructions `\tdplot...`. Les blocs Markdown étiquetés `tikz`, `latex`, `tex`, `circuitikz` ou `pgfplots` fonctionnent lorsqu’ils contiennent un schéma. Un préambule et les déclarations usuelles `\usepackage` / `\usetikzlibrary` sont acceptés.

L’aperçu reprend les couleurs de la conversation et propose :

- **− / +** pour zoomer, et le glisser pour déplacer le schéma ;
- le menu **…** pour **Fit diagram**, **Open editor**, **Copy code**, **Download PNG** ou **Download SVG** ;
- un éditeur plein écran avec le code à gauche, l’aperçu à droite et **Hide code** ;
- **Update** ou **Ctrl / ⌘ + Entrée** pour compiler une modification locale ;
- une erreur lisible, **Retry** et l’accès au code en cas d’échec.

Le PNG reprend l’apparence de l’aperçu. Le SVG conserve le dessin vectoriel et incorpore les polices utilisées. Les téléchargements concernent le schéma entier, indépendamment du déplacement de l’aperçu. Le réglage **LaTeX colors · white background** conserve les couleurs natives du dessin et inclut un fond blanc dans les exports PNG et SVG.

Les modifications faites dans l’éditeur restent un brouillon en mémoire dans l’extension : elles ne modifient ni le message ChatGPT, ni une requête envoyée au modèle. Copier le code permet de récupérer ce brouillon. Un rechargement de la page le perd ; une modification de la source par ChatGPT le remplace. L’export de conversation récupère la source enregistrée par ChatGPT, pas ce brouillon local.

Le popup propose **Enable in ChatGPT** pour activer les schémas, **Automatic rendering** pour le rendu automatique et **Initial zoom** pour leur taille initiale. **Open editor** ouvre une page complète avec exemples, code, aperçu et compilation par **Compile** ou **Ctrl / ⌘ + Entrée**. Si le rendu automatique est désactivé, utiliser **Render diagram** dans l’aperçu intégré.

### Apparence et couleurs

Le réglage **Appearance**, commun au popup et à l’éditeur, propose :

- **ChatGPT** : reprend le dernier thème observé dans un onglet ChatGPT ; utilise le thème du système tant qu’aucun thème du site n’a été observé ;
- **System** : suit les préférences claires ou sombres de l’appareil ;
- **Light** ou **Dark** : fixe l’apparence des pages de l’extension.

Le réglage distinct **Diagram colors** propose **Match theme** pour intégrer le dessin à son environnement, ou **LaTeX colors · white background** pour préserver ses couleurs natives. Il s’applique aux aperçus et aux téléchargements PNG/SVG. Les préférences sont conservées localement ; aucun rechargement du code TeX n’est nécessaire pour changer l’apparence.

## Pendant la génération d’une réponse

Un indicateur de chargement apparaît dès qu’un bloc de schéma est reconnu. Le moteur local se prépare pendant que ChatGPT continue d’écrire ; le code incomplet n’est pas encore soumis au compilateur.

La compilation peut commencer avant la fin de la réponse. Un bloc Markdown suivant indique que le bloc de code est terminé. Quand ChatGPT n’expose pas cette frontière, l’extension utilise un repli : une source inchangée depuis **180 ms**, avec accolades et environnements TeX fermés, peut être compilée. Cette détection structurelle reste une approximation ; si la source continue à évoluer, le même aperçu se met à jour.

La détection couvre aussi la structure actuelle observée sur ChatGPT, où un bloc contient plusieurs éléments `pre` imbriqués. Les mutations sont traitées par réponse concernée pour éviter de reparcourir toute la conversation à chaque token.

## Exporter une conversation

Le bouton **Export conversation** ajouté dans l’en-tête d’une conversation enregistrée ouvre une fenêtre avec les réglages à gauche et l’aperçu à droite. Trois formats sont disponibles :

- **Markdown (.md)** : un transcript lisible, avec les messages utilisateur et les réponses ChatGPT, sans répéter le JSON technique ; le code et le TeX sont conservés ;
- **Plain text (.txt)** : le même contenu, avec les principales décorations Markdown retirées et le code et les expressions TeX préservés ;
- **Complete archive (.json)** : toutes les réponses API récupérées, leurs champs et métadonnées, ainsi qu’une liste regroupée des messages, sans appliquer les filtres du transcript.

Choisir **Conversation**, **Detailed context**, **Answers only** dans **Content**, ou personnaliser les six options sous **Customize transcript** : mes messages, pièces jointes, sources et citations, dates/heures, étapes intermédiaires, appels et résultats d’outils. Les options du transcript ne retirent aucune donnée de l’archive JSON.

Cliquer sur **Preview** pour récupérer la conversation. La vue **Conversation** présente les messages en lecture ; la vue **File** montre le contenu exporté. Les formules y restent du code TeX, sans composition mathématique dans l’aperçu. L’affichage commence par 20 messages ou 50 000 caractères ; **Show more** permet de continuer. **Copy** et **Download** utilisent toujours le fichier entier. Les options modifient l’aperçu sans relire la conversation ; si celle-ci évolue, un message invite à l’actualiser.

L’export relit toutes les pages de la conversation auprès de ChatGPT au lieu de copier le texte visible de la page. La récupération doit aboutir avant qu’un fichier soit téléchargé ; une erreur ou une annulation ne produit pas un export présenté comme complet. La vue par défaut omet le contexte interne et les messages techniques, tout en conservant les références des images générées.

Les pièces jointes restent des références et métadonnées : leurs fichiers binaires ne sont pas téléchargés. Les anciennes branches ou versions absentes des réponses du serveur ne peuvent pas être reconstituées. Le JSON est le format le plus complet ; le Markdown privilégie la lecture. L’API interne de ChatGPT n’offre pas de garantie de stabilité et une évolution du site peut nécessiter une mise à jour. Voir [EXPORT.md](EXPORT.md).

## Moteur, performances et limites

TikZJax embarqué compile réellement TeX en WebAssembly et produit du SVG. Il comprend TikZ/PGF et une sélection de packages, notamment Circuitikz, PGFPlots, tikz-cd, Chemfig et tikz-3dplot.

Le moteur est partagé, préchauffé pendant le streaming et réutilisé entre les schémas. Les demandes identiques en cours partagent leur résultat. Un cache en mémoire conserve jusqu’à 24 résultats, dans une limite estimée de 20 Mio de chaînes source/SVG. Le worker est libéré après 90 secondes d’inactivité.

Le préchauffage réduit l’attente après la fermeture du bloc lorsque le moteur a pu se charger pendant le streaming. Les surfaces PGFPlots complexes restent coûteuses. Les chiffres de [tests/performance-results.md](tests/performance-results.md) décrivent une mesure historique de la v1.2 sur une seule machine ; ils ne constituent pas une mesure ou une garantie de performance de la v1.4.1.

Quelques adaptations concernent uniquement la copie envoyée au compilateur : bibliothèques TikZ usuelles déduites automatiquement, chargement de Chemfig et TikZ-3DPlot, protection des libellés Circuitikz contenant `=`, et remplacement de `shader=interp` par `shader=flat` avec avertissement pour PGFPlots.

L’extension n’est pas une distribution complète de TeX Live. Classes personnalisées, pagination de documents, BibTeX, fichiers externes, images importées, appels shell, gnuplot et moteurs LuaLaTeX/XeLaTeX sont hors périmètre. Un package absent ou un code incorrect peut produire une erreur.

Le code TikZ doit être présent dans le contenu accessible de la réponse. Pour un schéma écrit directement dans un paragraphe, l’aperçu est ajouté après ce paragraphe et son texte reste visible. Plusieurs schémas bruts dans le même paragraphe ne sont pas détectés ; plusieurs blocs de code distincts fonctionnent indépendamment.

## Confidentialité et fonctionnement

- La **compilation** reste sur l’appareil, avec le moteur et les polices fournis. Elle utilise les ressources locales de l’extension et aucun service de compilation distant.
- L’**export**, déclenché par **Preview**, **Copy** ou **Download**, effectue des lectures auprès de ChatGPT avec la session de l’onglet. Choisir un format ou modifier une option ne déclenche pas de lecture réseau. Un éventuel jeton d’authentification reste en mémoire et n’est ni enregistré, ni ajouté au fichier. Aucun transfert vers un service tiers n’est ajouté.
- Le code des conversations, les brouillons et le cache ne sont pas enregistrés dans les réglages. Les préférences d’export et le dernier thème ChatGPT observé sont conservés localement. L’éditeur autonome mémorise son dernier code localement.
- Les schémas sont détectés dans les réponses de l’assistant sur `chatgpt.com` et `chat.openai.com`. Le champ de saisie, les messages de l’utilisateur et les formules déjà rendues ne sont pas retraités.
- `storage` conserve les préférences. Chrome utilise aussi `offscreen` pour le moteur partagé ; Firefox utilise sa page d’arrière-plan et `clipboardWrite` pour terminer une copie après récupération asynchrone, sans lire le presse-papiers. L’accès au site est limité aux domaines ChatGPT. Firefox déclare l’authentification et l’activité de navigation nécessaires aux requêtes d’export vers ChatGPT.
- Une source est limitée à 60 000 caractères et une compilation à 30 secondes. Les erreurs TeX récupérables conservent le moteur chargé ; les erreurs internes et les dépassements de délai l’arrêtent.

## Dépannage et validation

**Aucun aperçu ou export après mise à jour :** actualiser l’extension puis recharger ChatGPT. Le pont d’export est installé au chargement de la page. Pour les schémas, vérifier les réglages et essayer **Open editor**.

**Manifeste introuvable :** sélectionner le dossier contenant directement `manifest.json`, pas le ZIP ni son dossier parent.

**Erreur de compilation :** réduire le code à un exemple minimal. Le moteur ne télécharge pas les packages manquants.

**Export refusé :** vérifier que la conversation enregistrée est ouverte dans une session connectée, puis recharger la page. Un changement de l’API peut nécessiter une mise à jour.

Les tests du dépôt utilisent des fixtures synthétiques pour vérifier le transcript, la pagination, les références de médias et la préservation du code et du TeX. Les tests locaux ne remplacent pas un essai du transport dans une session ChatGPT authentifiée ni une validation des boutiques. Résultats et limites : [VALIDATION.md](VALIDATION.md).

## Sources et licences

Code de l’extension : GPL-3.0-or-later. Les sources sont incluses, sans étape de compilation.

Moteur : `@rod2ik/tikzjax` 1.6.0, avec fichiers TeX, polices, notices, sources et modifications documentées dans `vendor/tikzjax/`. Les composants tiers conservent leurs licences propres.

- [Installation locale Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- [Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [API Offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [TikZJax](https://github.com/rod2ik/tikzjax)
- [Intégration Markdown/TikZ de référence](https://github.com/artisticat1/obsidian-tikzjax)
