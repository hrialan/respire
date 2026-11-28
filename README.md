# Respire

Cohérence cardiaque, simplement. Une webapp installable : une mer abstraite dans un hublot, dont la marée monte et descend avec ton souffle.

**→ https://hrialan.github.io/respire/**

## Ce qu'elle fait

- **Une séance guidée** : compte à rebours, « Inspirez / Expirez », temps restant, anneau de progression. La séance se termine toujours sur une respiration complète.
- **Une scène vivante** : l'orbe grossit et la marée monte à l'inspiration. Cinq couches de vagues, de l'écume, le reflet du soleil ou de la lune, des rayons sous l'eau le jour, du plancton lumineux la nuit.
- **Un ciel qui suit l'heure** : aube, jour, couchant, nuit étoilée, avec des transitions continues. Chaque moment a ses couleurs : lagon turquoise le jour, corail et or au couchant, indigo la nuit, avec une aurore boréale. Le bouton et l'anneau prennent la couleur du moment. On peut aussi forcer l'ambiance dans les réglages.
- **Des visiteurs** : des bateaux (voilier, dériveur, chalutier, goélette) et des mouettes traversent l’horizon au hasard : seuls ou à plusieurs, dans un sens ou dans l’autre, près ou au loin, et la nuit une étoile filante passe de temps en temps.
- **Une faune de rêve** : sous l'eau passent des bancs de poissons, des méduses, une baleine constellée de lumières, une raie manta, et des dauphins sautent hors de l'eau. La nuit, tout luit.
- **De la magie** : une aura irisée tourne autour du hublot et respire avec lui, des lucioles et des embruns lumineux montent doucement, le soleil rayonne et son reflet scintille, et parfois un arc-en-ciel apparaît. À l'ouverture, la scène sort du noir et le hublot s'ouvre dans un anneau de lumière.
- **Une scène qui respire avec toi** : pendant la séance, les lucioles montent quand tu inspires et flottent quand tu expires, l'aurore s'intensifie, et la lumière se réchauffe à l'inspiration puis s'apaise à l'expiration.
- **Des moments rares** : de temps en temps, une baleine saute hors de l'eau, une vague de lumière traverse le plancton, ou une pluie d'étoiles filantes traverse la nuit.
- **Une fête à la fin** : quand la séance se termine, des lumières s'envolent du hublot, l'aura s'illumine, et un moment rare arrive pour toi.
- **Fluide partout** : si le téléphone peine, la scène allège d'elle-même ses effets les plus coûteux.
- **Vibrations (Android)** : une impulsion à l'inspiration, deux à l'expiration, et un motif en fin de séance. Sur iPhone, Safari ne permet pas aux sites de vibrer pendant la séance : c'est alors le son qui guide.
- **Le son (au choix)** : des **vagues** qui se retirent à l'inspiration et déferlent à l'expiration, chacune un peu différente ; ou le **vent**, qui se lève et retombe avec le souffle ; ou seulement les **repères**. À chaque changement de phase, un ping de sonar (une brève impulsion de note pure qui résonne longuement dans l'eau profonde, plus aiguë pour inspirer, plus grave pour expirer) : on peut respirer les yeux fermés. En fond, une nappe d'accords qui s'ouvre à l'inspiration et dont la couleur suit l'heure. À la fin, une cascade de notes cristallines ; quand une baleine saute, son chant lointain. Tout est généré en direct, sans fichier audio, et joue même quand l'iPhone est en mode silencieux.
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

Paramètres d'URL utiles pour tester (ils se combinent : `?h=23&moment`) :

| Paramètre | Effet |
| --- | --- |
| `?h=19` | force l'heure du ciel (en mode Auto) : `7` aube, `13` jour, `19` couchant, `23` nuit |
| `?moment` | un moment rare toutes les 25 s (baleine qui saute, vague de plancton lumineux, pluie d'étoiles filantes) |
| `?fete` | joue la fête de fin de séance 4 s après le chargement |

### Organisation

| Fichier | Rôle |
| --- | --- |
| `index.html` | structure : scène, légende, boutons, panneau de réglages |
| `style.css` | mise en page, panneau de réglages, états (`data-state` sur `#app`), arrivée du texte et du bouton |
| `app.js` | moteur de séance (machine à états calée sur l'horloge), réglages, vibrations, verrouillage de l'écran |
| `scene.js` | toute la scène sur un `<canvas>` plein écran : palettes du ciel selon l'heure, vagues, lumière, visiteurs, faune, magie (aura, lucioles, aurore), moments rares, fête de fin. La couleur d'accent de l'interface suit la palette |
| `audio.js` | le son en Web Audio : vagues ou vent (bruit rose filtré en plusieurs bandes), nappe d'accords selon l'heure, ping de sonar, cloches et chant de baleine dans une réverbération générée |
| `sw.js` | service worker : réseau d’abord (toujours à jour en ligne), cache hors ligne |
| `manifest.webmanifest` | métadonnées de la PWA |
| `icons/` | icônes : le hublot-souffle (un hublot coupé par une vague, qui est aussi la courbe d'une respiration). Les PNG sont générés par `tools/make_icons.py`, le SVG est fait à la main avec les mêmes formes et couleurs |

Le flux d'une image : `app.js` calcule à chaque frame le niveau du souffle (0 = poumons vides, 1 = pleins). Il le passe à `Scene.draw()` (taille de l'orbe, marée, et tout ce qui suit le souffle) et à `Ambience.update()` (force et timbre des vagues ou du vent). À chaque changement de phase, il appelle `Ambience.cue()` (le ping de sonar). À la fin d'une séance, il appelle `Scene.celebrate()` et `Ambience.celebrate()`. Quand une baleine saute, la scène le signale (`Scene.onMoment`) et `app.js` joue son chant.

### Régénérer les icônes

```sh
uv run tools/make_icons.py
```

### Publier

Il suffit de pousser sur `main` : GitHub Pages republie en une minute environ. Les apps déjà installées récupèrent la mise à jour à la prochaine ouverture. Si tu ajoutes un fichier, ajoute-le aussi à `ASSETS` dans `sw.js` et change le numéro de `CACHE`.

## Statistiques

La mesure d'audience passe par [GoatCounter](https://www.goatcounter.com) : open source, **sans cookies** et sans donnée personnelle. Aucun bandeau de consentement n'est donc nécessaire. Le tableau de bord se trouve sur https://hrialan-respire.goatcounter.com.

En plus des pages vues, l'app envoie ces événements :

| Événement | Quand |
| --- | --- |
| `seance/demarree` | au lancement d'une séance |
| `seance/terminee` | quand la séance va jusqu'au bout |
| `seance/interrompue` | quand on arrête avant la fin |
| `mode/app` · `mode/web` | depuis l'app installée ou depuis le navigateur |
| `reglages/duree-…`, `reglages/rythme-…`, `reglages/ciel-…`, `reglages/son-…`, `reglages/vibration-…` | les réglages au lancement |

Les visites depuis `localhost` ne sont pas comptées. Si le script est bloqué ou si l'on est hors ligne, l'app fonctionne normalement.
