# Respire

Cohérence cardiaque, simplement. Une webapp installable : une mer abstraite dans un hublot, dont la marée monte et descend avec ton souffle.

**→ https://hrialan.github.io/respire/**

## Ce qu'elle fait

- **Une séance guidée** : compte à rebours, « Inspirez / Expirez », temps restant, anneau de progression. La séance se termine toujours sur une respiration complète.
- **Une scène vivante** : l'orbe grossit et la marée monte à l'inspiration. Cinq couches de vagues, de l'écume, le reflet du soleil ou de la lune, des rayons sous l'eau le jour, du plancton lumineux la nuit.
- **Un ciel qui suit l'heure** : aube, jour, couchant, nuit étoilée, avec des transitions continues. On peut aussi forcer l'ambiance dans les réglages.
- **Des visiteurs au hasard** : une étoile filante la nuit, une mouette de temps en temps, et pendant la séance un voilier qui passe au loin.
- **Vibrations** : une impulsion à l'inspiration, deux à l'expiration, et un motif en fin de séance. Sur Android, c'est l'API Vibration. Sur iPhone (iOS 18 et plus), c'est un léger retour haptique système.
- **Son optionnel** : un ressac doux et une nappe chaude, générés en direct, qui suivent la respiration.
- L'écran reste allumé pendant la séance. L'app fonctionne hors ligne et compte tes séances du jour.

**Réglages** : durée (3, 5, 10 ou 15 min), rythme (5·5, 4·6, 4·4 ou personnalisé), ciel, vibration, son.

**Raccourcis** : toucher l'écran pour mettre en pause ou reprendre · Espace pour démarrer ou mettre en pause · Échap pour arrêter.

## Installer sur son téléphone

- **iPhone** : ouvrir le lien dans Safari → Partager → *Sur l'écran d'accueil*.
- **Android** : Chrome → menu → *Installer l'application*.

## Développer

Pas de dépendance ni de build : HTML, CSS et JavaScript, rien d'autre.

```sh
uv run python -m http.server 8000    # → http://localhost:8000
```

Paramètres d'URL utiles pour tester :

| Paramètre | Effet |
| --- | --- |
| `?h=19` | force l'heure du ciel (en mode Auto) : `7` aube, `13` jour, `19` couchant, `23` nuit |
| `?boat` | le voilier et les mouettes passent en boucle, sans attendre |
| `?gulls` | seulement les mouettes, en boucle |

### Organisation

| Fichier | Rôle |
| --- | --- |
| `index.html` | structure : scène, légende, boutons, panneau de réglages |
| `style.css` | mise en page, panneau de réglages, états (`data-state` sur `#app`) |
| `app.js` | moteur de séance (machine à états calée sur l'horloge), réglages, vibrations, verrouillage de l'écran |
| `scene.js` | toute la scène sur un `<canvas>` plein écran : palettes du ciel selon l'heure, vagues, lumière, visiteurs |
| `audio.js` | ambiance sonore Web Audio : bruit rose filtré et nappe d'accords |
| `sw.js` | service worker : cache hors ligne (sert d'abord le cache, puis le met à jour en arrière-plan) |
| `manifest.webmanifest` | métadonnées de la PWA |
| `icons/` | icônes. Les PNG sont générés par `tools/make_icons.py`, le SVG est fait à la main |

Le flux d'une image : `app.js` calcule à chaque frame le niveau du souffle (0 = poumons vides, 1 = pleins). Il le passe à `Scene.draw()` (taille de l'orbe et marée) et à `Ambience.update()` (volume et timbre du ressac).

### Régénérer les icônes

```sh
uv run tools/make_icons.py
```

### Publier

Il suffit de pousser sur `main` : GitHub Pages republie en une minute environ. Les apps déjà installées récupèrent la mise à jour à la deuxième ouverture. Si tu ajoutes un fichier, ajoute-le aussi à `ASSETS` dans `sw.js` et change le numéro de `CACHE`.
