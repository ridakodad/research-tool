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

Le logo s'affiche en haut à gauche, hauteur imposée à 36 px et largeur libre
(jusqu'à 200 px), posé sur un support blanc arrondi. Ce support n'est pas un
détail : un logo institutionnel est dessiné pour le papier, ses couleurs
deviennent illisibles sur fond sombre. Il lui donne la même assise dans les
deux thèmes.

**Préférez le symbole seul au bloc-marque complet.** À 36 px de haut, le texte
d'un bloc-marque — nom de l'établissement sur plusieurs lignes — se réduit à
quelques pixels par lettre et ne se lit pas. Le symbole seul, lui, reste
reconnaissable. Le nom de l'établissement est de toute façon écrit en toutes
lettres sur le plan de travail.

Tant qu'aucun de ces fichiers n'est présent, un monogramme neutre aux couleurs
de la charte prend sa place. C'est délibérément une marque neutre et non une
imitation du logo : une approximation donnerait à l'application un air
d'officiel qu'elle n'a pas.

## Pourquoi le logo n'est pas versionné ici

C'est une marque déposée de l'établissement, pas un élément du code. La garder
hors du dépôt évite de la diffuser avec le code source, et laisse chaque
installation afficher sa propre identité.
