# CLAUDE.md

Respire : une webapp de cohérence cardiaque (PWA), en HTML, CSS et JavaScript, **sans dépendance ni build**. Le `README.md` décrit les fonctions, le rôle de chaque fichier et les statistiques : lis-le avant de modifier quelque chose.

## Commandes

- Serveur local : `uv run python -m http.server 8000`. Python passe toujours par `uv`, jamais par un `python3` nu.
- Icônes : `uv run tools/make_icons.py`.
- Pas de tests ni de linter. Vérifie dans le navigateur. Pour tester le ciel à une heure donnée : `?h=19`. Pour voir un moment rare toutes les 25 s : `?moment`. Pour voir la fête de fin de séance sans faire une séance : `?fete`. Ils se combinent : `?h=23&moment`.

## Publier

- **Avant chaque commit d'une nouvelle fonction, l'utilisateur la teste et la valide en local.** Lance le serveur local, donne-lui l'URL à ouvrir (avec `?h=…` si c'est utile) et ce qu'il doit regarder. Attends son accord avant de commiter ou d'ouvrir la PR.
- **Ne pousse jamais directement sur `main`**, même si on te le demande. Crée une branche, pousse-la et ouvre une pull request avec `gh pr create`. La fusion revient à l'utilisateur. Une règle GitHub (ruleset « Protéger main ») refuse de toute façon les push directs, les force-push et la suppression de `main`.
- La fusion sur `main` publie le site (GitHub Pages).
- **À chaque changement livré, change le numéro de `CACHE` dans `sw.js`** (`respire-vN`). Sans ça, les apps installées gardent l'ancienne version plus longtemps. Si tu ajoutes un fichier, ajoute-le aussi à `ASSETS`.
- Messages de commit en français, au format « Zone : ce qui change » (par exemple `Son du vent : …`, `iPhone : …`).

## Architecture : les points piégeux

- `app.js` calcule le souffle (0..1) à partir de l'horloge, à chaque frame. Il le passe à `Scene.draw()` et à `Ambience.update()`. À chaque changement de phase, il appelle `Ambience.cue()`. À la fin d'une séance, il appelle `Scene.celebrate()` puis `Ambience.celebrate()` (avant `Ambience.stop()`). Le réglage `sound` vaut `waves`, `wind`, `cues` ou `off` (l'ancien booléen est migré au chargement). Les états sont dans `data-state` sur `#app` : `home → countdown → running ⇄ paused → done`.
- L'orbe est **dessinée sur le canvas plein écran** (`scene.js`). L'anneau de progression, lui, est un SVG dans le DOM (`#orbAnchor`). La scène relit la position de `#orbAnchor` à chaque frame pour que les deux restent superposés. Ne remplace pas cette lecture par un `ResizeObserver` : l'ancre peut bouger sans changer de taille, par exemple quand la légende change de hauteur.
- `scene.js` aligne la couleur de fond de la page (`--bg`) et le `theme-color` sur la palette du ciel. Ça évite qu'une bande noire apparaisse sous les barres de Safari ou sous la barre d'accueil de l'iPhone.

## Contraintes iPhone (la cible principale)

- Safari ne laisse pas un site vibrer pendant une séance. Sur iPhone, c'est le son qui guide.
- Le son passe par Web Audio et `navigator.audioSession` pour jouer même en mode silencieux. Il doit démarrer suite à un geste de l'utilisateur.
- Il faut gérer les zones de sécurité (`env(safe-area-inset-*)`, `viewport-fit=cover`) et les unités `dvh`/`lvh`. Les écrans étroits et hauts sont les plus sensibles.
- Tu ne peux pas tester sur un vrai iPhone. Dis-le quand un correctif concerne iOS, et demande à l'utilisateur de vérifier.

## Style

- Les textes de l'interface sont en français et vouvoient (« Touchez l'écran… »). Le README tutoie.
- Les commentaires d'en-tête des fichiers sont en français. Les commentaires dans le code sont surtout en anglais, comme dans l'existant.
- Pas de bibliothèque externe. Seule exception : le script GoatCounter, chargé depuis `index.html`.
