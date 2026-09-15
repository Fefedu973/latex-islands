# Exporter une conversation ChatGPT — v1.4.1

Le bouton **Export conversation** dans l’en-tête d’une conversation enregistrée ouvre une fenêtre à deux panneaux : les réglages et l’aperçu. L’export récupère les données JSON de ChatGPT, sans reconstruire le contenu à partir du texte affiché sur la page.

## Choisir le contenu et le format

| Format | Contenu |
| --- | --- |
| **Markdown (.md)** | Transcript de la conversation avec messages utilisateur, réponses ChatGPT, code et TeX, sans copie du JSON technique sous chaque message. |
| **Plain text (.txt)** | Même sélection de messages, avec les principales décorations Markdown retirées. Le code et les expressions TeX sont conservés. |
| **Complete archive (.json)** | Toutes les pages JSON reçues, leurs métadonnées et une liste regroupée des messages. Les options du transcript ne filtrent pas cette archive. |

L’interface est en anglais. Pour Markdown et texte brut, le menu **Content** propose trois préréglages : **Conversation**, **Detailed context** et **Answers only**. La section **Customize transcript** permet de choisir séparément :

- **Include my messages** ;
- **Include attachment references** ;
- **Include sources and citations** ;
- **Show dates and times**, en UTC ;
- **Include progress updates** affichables ;
- **Include tool calls and results**.

Par défaut, le transcript contient les messages utilisateur et les réponses finales, avec les références des médias générés. Le contexte interne, les messages système, les analyses cachées et les sorties d’outil vides sont omis. Le préréglage détaillé ajoute les étapes intermédiaires et les outils affichables ; il ne transforme pas le transcript en copie intégrale de tous les champs internes. Ces champs restent dans le JSON.

Les sources structurées disponibles sont converties en liens lisibles. Une citation dont la source manque est signalée ; aucune URL n’est inventée. Les images et pièces jointes sont mentionnées une seule fois lorsque le contenu et les métadonnées désignent le même fichier. Un lien utilisable est conservé s’il existe ; les pointeurs internes sont remplacés par une mention lisible. **Les fichiers binaires ne sont pas téléchargés ni intégrés à l’export.**

## Prévisualiser, copier, télécharger

1. Choisir un format dans **Format** et un contenu dans **Content**.
2. Cliquer sur **Preview** pour récupérer la conversation.
3. Ajuster les options et contrôler le résultat.
4. Utiliser **Copy** ou **Download**.

La vue **Conversation** affiche les messages dans une présentation de lecture ; la vue **File** montre le contenu produit. Le JSON utilise la vue fichier. Le Markdown courant est mis en forme dans la vue dialogue ; **les formules y restent du code TeX**, sans rendu mathématique. La vue fichier et les téléchargements conservent le TeX et le code source.

Pour éviter un aperçu trop volumineux, l’affichage commence par **20 messages** en vue dialogue ou **50 000 caractères** en vue fichier. **Show more** ajoute les messages ou caractères suivants. **Copy** et **Download** utilisent toujours tout le fichier, indépendamment de la portion affichée.

Changer les options met à jour l’aperçu déjà chargé sans nouvelle requête. Si les messages de ChatGPT évoluent, l’interface signale que l’aperçu doit être actualisé ; l’action suivante récupère la version à jour. Les options sont mémorisées localement, mais la conversation récupérée reste en mémoire. Choisir un format ou une option ne déclenche pas à lui seul de lecture de conversation.

La récupération doit se terminer avant la copie ou le téléchargement. Un refus HTTP, un format inconnu, un curseur manquant ou répété, un changement de conversation ou une annulation arrête l’export. Fermer la fenêtre annule une récupération en cours. Aucun fichier partiel n’est présenté comme complet.

## Portée de l’archive

L’archive correspond aux données renvoyées par ChatGPT au moment de la lecture. Toutes les pages récupérées et leurs champs sont conservés dans `raw_pages`. La liste `messages` regroupe les pages et déduplique les identifiants : si plusieurs copies d’un message se recouvrent, la copie la plus récente est retenue dans cette liste ; toutes les copies restent dans les pages originales.

Le format paginé couvre la conversation courante exposée par le serveur. Il ne promet pas les anciennes branches ou versions que l’API ne renvoie pas. Les champs de versions éventuellement présents sont conservés. L’ancien format `mapping`, quand il est disponible, conserve tous ses nœuds et leurs liens parent/enfants dans `raw_pages` ; le transcript suit alors la branche sélectionnée par `current_node`.

Les messages du format paginé restent dans l’ordre du serveur. Les identifiants de parent et de tour peuvent être incomplets ou réutilisés : ils ne servent pas à reconstruire arbitrairement la conversation. Le JSON fait référence pour la topologie, les champs inconnus, les ressources multimédias et les différentes copies de messages reçues.

Une réponse encore en cours de génération peut évoluer après l’export. Les modifications locales dans l’éditeur TikZ de l’extension ne modifient pas les messages enregistrés par ChatGPT et ne font donc pas partie de cet export.

## Fonctionnement du transport

Le transport utilise les chemins internes suivants :

1. `GET /backend-api/conversations/{id}?include_has_versions=true&num_turns=10`
2. Si `page_info.has_previous_page` vaut `true`, `GET /backend-api/conversations/{id}/messages?include_has_versions=true&num_turns=10&before={start_cursor}` jusqu’à la première page.
3. Si le premier chemin renvoie HTTP 404 ou 405, essai de l’ancien `GET /backend-api/conversation/{id}` et vérification de la présence du `mapping`.

`conversation-bridge.js`, déclaré dans le monde `MAIN`, effectue les lectures avec les cookies de la page. Après un HTTP 401, il peut lire `/api/auth/session` et réessayer avec le jeton de session. Ce jeton reste en mémoire dans le pont et est effacé à la fin ou à l’annulation de l’export. Il n’est ni envoyé au script isolé, ni enregistré, ni ajouté au fichier. Aucun transfert vers un service tiers n’est ajouté.

Le pont accepte uniquement des requêtes GET vers les chemins autorisés de la conversation actuellement ouverte, sur la même origine, avec des paramètres bornés. Le transport vérifie l’origine, la fenêtre source et l’identifiant de requête. Le pont reste dans le contexte de confiance du site ChatGPT.

Chaque requête du pont expire au bout de 45 secondes et le parcours est borné à 500 pages. L’API du site est interne et peut changer : les formats inconnus produisent une erreur explicite. Recharger les onglets ChatGPT après l’installation ou le rechargement de l’extension est nécessaire pour activer le pont.

## Vérification

```powershell
node --test tests/export.test.cjs tests/export-bridge.test.cjs tests/export-ui.test.cjs
```

Les fixtures sont synthétiques. Elles vérifient notamment la pagination et ses échecs, la préservation des pages et métadonnées, les filtres du transcript, les pièces jointes, les citations, le code et le TeX, le repli vers l’ancien format, les restrictions du pont, la non-transmission du jeton, l’annulation et la navigation.

Les tests automatisés n’établissent pas à eux seuls la compatibilité avec une session ChatGPT authentifiée active. Les résultats de validation de cette version sont décrits dans [VALIDATION.md](VALIDATION.md).
