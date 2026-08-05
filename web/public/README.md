# Fichiers publics

Le contenu de ce dossier est servi tel quel à la racine du site :
`web/public/logo-hopital.png` est accessible à l'adresse `/logo-hopital.png`.

## Déposer le logo de l'établissement

Placez le fichier ici sous l'un de ces noms :

```
web/public/logo-hopital.svg     ← préféré (net à toutes les tailles)
web/public/logo-hopital.png
web/public/logo-hopital.jpg
```

L'application essaie ces trois noms dans cet ordre et retient le premier
trouvé. Aucune modification de code n'est nécessaire.

Reconstruisez ensuite pour que le fichier soit repris dans `web/dist` :

```bash
npm run build
```

Le logo s'affiche en haut à gauche, hauteur imposée à 34 px et largeur libre
(jusqu'à 200 px). Le bloc-marque complet — symbole et texte — comme le symbole
seul passent donc sans déformation ; à cette hauteur, le symbole seul reste le
plus lisible.

Tant qu'aucun de ces fichiers n'est présent, un monogramme neutre aux couleurs
de la charte prend sa place. C'est délibérément une marque neutre et non une
imitation du logo : une approximation donnerait à l'application un air
d'officiel qu'elle n'a pas.

## Pourquoi le logo n'est pas versionné ici

C'est une marque déposée de l'établissement, pas un élément du code. La garder
hors du dépôt évite de la diffuser avec le code source, et laisse chaque
installation afficher sa propre identité.
