# Exploitation de dossiers patients

Application web pour constituer un jeu de données de recherche à partir de
dossiers patients hétérogènes : import des documents (Word, PDF, images,
DICOM), extraction guidée par une **fiche d'exploitation paramétrable**,
relecture assistée, visualisation et export CSV.

Pensée pour un travail de thèse ou une étude rétrospective : on part d'une pile
de dossiers, on obtient un tableau exploitable dans Excel, R ou SPSS — sans
ressaisir chaque variable à la main, et sans perdre la trace de l'origine de
chaque valeur.

---

## Ce que fait l'application

**1. Importer les dossiers.** Glissez une arborescence : chaque sous-dossier
devient un dossier patient et son nom sert de code. Les documents sont analysés
à l'import.

| Format | Ce qui est exploité |
|---|---|
| PDF | Couche texte, lignes reconstituées par position |
| Word (`.docx`) | Texte et tableaux (les cellules restent appariées « libellé / valeur ») |
| Images (JPEG, PNG, TIFF) | Reconnaissance optique de texte + date EXIF du cliché |
| DICOM (`.dcm`, sans extension) | Métadonnées : âge, sexe, modalité, date d'examen, paramètres d'acquisition |

Les doublons sont détectés par empreinte du contenu, pas par nom de fichier.

**2. Définir la fiche d'exploitation.** La fiche est la liste des variables de
votre étude, organisée en sections. Chaque variable a un type (texte, nombre,
entier, date, oui/non, choix unique, choix multiple), une unité, une définition,
et — c'est le cœur — la façon dont elle se retrouve dans les documents.

**3. Extraire.** Une passe applique la fiche à tous les dossiers, par des
**règles** que vous paramétrez, par **Claude**, ou par les deux. Chaque valeur
trouvée conserve **le document et l'extrait qui la justifient**.

**4. Relire.** Dossier par dossier, chaque variable affiche son origine (règle,
Claude, ou relecture humaine), sa confiance, et sa justification. Une valeur
corrigée à la main est marquée comme telle et **n'est jamais écrasée** par une
extraction ultérieure.

**5. Analyser et exporter.** Tableau brut, distributions par variable, taux de
remplissage, export CSV et dictionnaire des variables.

---

## Démarrage

```bash
npm install          # Node 22 ou plus récent
npm run build
npm start            # http://localhost:4000
```

L'installation ne compile aucun module natif : le stockage s'appuie sur le
module SQLite intégré à Node, il n'y a donc ni chaîne de compilation C++ ni
outils Visual Studio à installer. Sous Node 22, Node affiche au démarrage un
avertissement indiquant que ce module est expérimental ; il disparaît à partir
de Node 24, où il est stable.

En développement (front et API séparés, rechargement à chaud) :

```bash
npm run dev          # front sur 5173, API sur 4000
```

Pour découvrir l'application avec des données factices :

```bash
npm run demo --workspace server           # écrit 24 dossiers dans data/demo/
```

Glissez ensuite `data/demo/` dans l'écran « Importer des dossiers » — c'est
aussi l'occasion d'essayer l'import tel qu'il se pratique.

Pour aller plus vite, l'option `--upload` importe directement via l'API. Elle
suppose donc que l'application **tourne déjà** : laissez `npm start` actif dans
un premier terminal et lancez la commande dans un second.

```bash
npm run demo --workspace server -- --upload
```

Dans les deux cas, il reste à cliquer sur « Lancer l'extraction » depuis
l'écran « Dossiers patients ».

Une fiche d'exploitation générale est fournie au premier démarrage (identité,
antécédents, clinique, paraclinique, prise en charge, évolution). Elle est
entièrement modifiable et sert surtout d'exemple de paramétrage.

---

## Les règles d'extraction

Une variable peut avoir plusieurs règles. Elles sont évaluées **dans l'ordre** :
la première qui produit une valeur conforme au type de la variable l'emporte,
les suivantes servent de repli. Une correspondance intypable — « Âge : NR » —
laisse la main à la règle suivante plutôt que d'échouer.

Toutes les recherches ignorent la casse, les accents et les variantes
d'apostrophe : `Durée d'hospitalisation` retrouve aussi bien
`DUREE D HOSPITALISATION` que `Durée d’hospitalisation`.

### Libellé suivi de la valeur

La forme la plus courante dans un compte rendu.

```
Libellés : « Âge », « Age du patient »
→ trouve « Âge : 54 ans » puis convertit en 54
```

### Présence de mots-clés

Émet une valeur fixe si l'un des termes apparaît. Les **termes d'exclusion**
gèrent la négation, en restant limités à la proposition en cours :

```
Termes         : diabète, diabétique
Exclusions     : pas de, absence de
Valeur         : Oui
Si nié         : Non
```

Sur `Antécédents : pas de diabète, HTA sous traitement`, le diabète est
enregistré à `Non` et l'HTA n'est pas contaminée par le « pas de » qui précède.
`ni` prolonge la négation : `pas de diabète, ni d'HTA` nie bien les deux.

Distinguer « absence documentée » de « donnée manquante » compte à l'analyse :
c'est le rôle du champ « si nié ».

### Expression régulière

Pour ce que le libellé ne couvre pas. Le premier groupe capturant est retenu.

```
patient de (\d{1,3}) ans
```

### Tag DICOM

Par mot-clé (`PatientAge`, `Modality`, `StudyDate`) ou par code (`00101010`).

### Post-traitement

- **Correspondances** — ramène un code ou une abréviation vers vos options :
  `CT = Scanner`, `MR = IRM`, `H = Masculin`.
- **Bornes de plausibilité** — une valeur hors bornes est rejetée et la règle
  suivante prend le relais. C'est ce qui évite de capturer « 120 ans
  d'évolution » comme un âge.
- **Facteur de conversion** — pour homogénéiser des unités.

### Banc d'essai

L'éditeur de variable teste une règle sur un texte collé ou sur un dossier
réel, sans rien enregistrer : la valeur extraite, sa confiance et l'extrait
justificatif s'affichent immédiatement.

---

## Remplissage automatique par Claude

Les règles excellent sur ce qui est structuré — `Âge : 54 ans`, un tableau de
biologie, un tag DICOM. Elles atteignent leur limite sur le texte rédigé, où
l'information n'est introduite par aucun libellé : *« patient de 54 ans adressé
pour une dyspnée d'effort évoluant depuis six mois »*. C'est là que Claude prend
le relais.

### Les trois modes d'extraction

Le mode se choisit dans l'écran « Dossiers patients », avant de lancer la passe.

| Mode | Ce qu'il fait | Quand l'utiliser |
|---|---|---|
| **Règles seules** | N'applique que votre paramétrage | Par défaut. Gratuit, hors connexion, reproductible |
| **Règles puis Claude** | Les règles d'abord ; Claude ne reçoit que les variables restées vides | Le meilleur rapport coût/rendement |
| **Claude seul** | Soumet toute la fiche au modèle | Comparer les deux approches, ou démarrer une étude sans avoir encore écrit de règles |

Le mode mixte est celui à privilégier : ce qu'une règle a trouvé n'est pas
renvoyé au modèle, ce qui réduit d'autant le texte facturé et laisse la
reproductibilité des règles là où elle est acquise.

### Ce qui empêche une valeur inventée d'entrer dans le jeu de données

Un modèle qui comble une case vide par une valeur plausible est plus coûteux
qu'une case restée vide : l'erreur devient invisible à l'analyse. Toute valeur
proposée franchit donc **deux contrôles indépendants** avant d'être enregistrée.

1. **Citation retrouvée.** Le modèle doit accompagner chaque valeur d'un extrait
   recopié du document. Cet extrait est **recherché dans le texte réellement
   extrait du dossier** : introuvable, la valeur est écartée. La comparaison
   tolère la casse, les accents et la mise en forme — un modèle ne recopie pas
   les sauts de ligne d'un PDF à l'identique — mais rien d'autre. Une valeur
   courte (« 54 ») sans citation est écartée elle aussi : la retrouver quelque
   part dans un compte rendu ne justifie rien.
2. **Typage par la fiche.** La valeur passe ensuite par le même contrôle que
   celles des règles : type déclaré, liste d'options, bornes de plausibilité.
   Un `sexe` hors liste ou un âge de 540 ans est écarté.

L'extrait affiché en relecture est **celui du document**, pas celui recopié par
le modèle. Le compte des valeurs écartées — sans citation, ou non conformes à la
fiche — est affiché à la fin de la passe : c'est une indication utile sur la
qualité des documents et sur le paramétrage de la fiche.

Une valeur retenue est marquée `Claude` avec sa confiance (90 % si la citation
elle-même a été retrouvée, 75 % si seule la valeur l'a été), distincte de
`Règle` et de `Vérifié`. Le filtre « à relire » de l'écran de relecture reste le
passage obligé : **rien de ce qui vient d'un modèle ne devrait entrer dans une
publication sans relecture humaine.**

### Configuration

Le mode est indisponible tant qu'aucune clé API n'est renseignée ; l'interface
l'indique et n'active que le mode « Règles seules ».

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # Windows : setx ANTHROPIC_API_KEY sk-ant-...
npm start
```

| Variable | Défaut | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clé API. Sans elle, seules les règles sont disponibles |
| `LLM_MODEL` | `claude-opus-5` | Modèle utilisé |
| `LLM_EFFORT` | `high` | Profondeur de raisonnement. `medium` ou `low` réduisent le coût sur de grandes séries |
| `LLM_MAX_CHARS_PER_DOC` | `60000` | Texte transmis par document, pour borner le coût d'un dossier volumineux. Au-delà, le document est tronqué et signalé comme tel au modèle |
| `LLM_MAX_TOKENS` | `16000` | Plafond de génération |

### Coût

Un appel par dossier patient. La consigne et le dictionnaire des variables sont
identiques d'un dossier à l'autre : ils sont mis en cache et ne sont facturés au
tarif plein qu'une fois par série. Le reste dépend de la longueur des documents.
Le décompte des jetons consommés — dont la part lue depuis le cache — s'affiche
à la fin de chaque passe.

Une série se lance sur un sous-ensemble de dossiers : commencez par quelques-uns
pour mesurer le coût et la qualité avant d'engager la cohorte entière.

---

## Export

- **CSV du jeu de données** — séparateur `;` (Excel français) ou `,` (R,
  Python, SPSS) ; variables oui/non en `1`/`0` ou `Oui`/`Non` ; en-têtes en clés
  techniques ou en libellés. Encodé UTF-8 avec marque d'ordre des octets pour
  qu'Excel affiche correctement les accents. Les choix multiples occupent une
  colonne, options séparées par `|`.
- **Dictionnaire des variables** — type, unité, options et définition de chaque
  variable. À joindre au jeu de données pour qu'il reste interprétable.
- **Fiche au format JSON** — sauvegarde et partage du paramétrage entre postes
  ou entre études, réimportable depuis l'écran « Fiche d'exploitation ».

---

## Reconnaissance optique (OCR)

L'OCR traite les photos et scans de comptes rendus. Il repose sur
`tesseract.js` et sur les données de langue françaises, installées comme
dépendances : **il fonctionne hors connexion**, sans téléchargement au premier
usage.

| Variable | Effet |
|---|---|
| `OCR_ENABLED=0` | Désactive l'OCR (import plus rapide) |
| `OCR_LANG` | Langue de reconnaissance, `fra` par défaut |
| `OCR_LANG_PATH` | Dossier de données de langue personnel |

Pour une autre langue : `npm install @tesseract.js-data/eng --workspace server`
puis `OCR_LANG=eng`.

L'écran « Dossiers patients » signale l'indisponibilité de l'OCR, et le détail
d'un document indique quand aucun texte n'a pu être extrait.

**Limite connue :** un PDF scanné (sans couche texte) n'est pas passé à l'OCR —
seules les images le sont. L'interface le signale explicitement sur le document
concerné. Convertir ces PDF en images avant import contourne la limite.

---

## Identité visuelle

L'interface est un **plan de travail** : le rail de gauche présente en
permanence tous les outils, groupés par nature du travail — constituer le
corpus, régler les instruments, lire les résultats, sortir les données.
L'extraction n'est qu'un outil parmi eux.

### Déposer le logo de l'établissement

Le logo officiel n'est pas versionné dans le dépôt : c'est une marque déposée
de l'établissement, pas un élément du code. Déposez-le dans `web/public/` sous
l'un de ces noms — l'application essaie les trois dans cet ordre, sans aucune
modification de code :

```
web/public/logo-hopital.svg     ← préféré (net à toutes les tailles)
web/public/logo-hopital.png
web/public/logo-hopital.jpg
```

Reconstruisez ensuite (`npm run build`) pour que le fichier soit repris dans
`web/dist`. Il apparaît en haut à gauche, hauteur imposée à 34 px et largeur
libre jusqu'à 200 px : le bloc-marque complet comme le symbole seul passent
sans déformation — à cette hauteur, le symbole seul reste le plus lisible.

Tant que le fichier est absent, un monogramme neutre aux couleurs de la charte
prend sa place. Ce n'est volontairement pas une imitation du logo : une
approximation donnerait à l'application un air d'officiel qu'elle n'a pas.

### Couleurs

La palette est dérivée du logo — vert forêt, rouge brique, vert tilleul de la
sphère, encre presque noire — et déclarée en jetons dans
`web/src/styles.css`. Chaque couleur portant du texte tient au minimum 4,5:1
de contraste, dans les deux thèmes ; les valeurs mesurées sont notées en
commentaire à côté de chaque jeton.

Deux règles encadrent l'usage du rouge et du vert. Le rouge n'encode jamais de
donnée : il ne sert qu'aux états critiques. Les graphiques n'ont qu'une série,
portée par une seule teinte séquentielle verte. Un couple vert/rouge porteur de
sens serait indistinguable sous déficience de vision des couleurs.

Le thème clair ou sombre suit le système par défaut, et se force depuis la
barre supérieure. Toute animation s'efface si le système demande la sobriété
(`prefers-reduced-motion`).

---

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | Port de l'API |
| `DATA_DIR` | `./data` | Base SQLite et fichiers importés |
| `DB_PATH` | `$DATA_DIR/research-tool.db` | Emplacement de la base |
| `MAX_UPLOAD_BYTES` | `200 Mo` | Taille maximale d'un fichier |
| `CORS_ORIGINS` | `localhost:5173` | Origines autorisées (développement) |

Les variables propres à l'OCR et à l'extraction par Claude sont documentées dans
leurs sections respectives.

Les documents importés sont conservés tels quels sous `DATA_DIR/uploads/`, sous
un nom généré ; le nom d'origine reste affiché dans l'interface.

---

## Données personnelles

L'application ne comporte ni authentification ni chiffrement : elle est prévue
pour un poste de travail ou un serveur d'établissement maîtrisé, pas pour une
exposition publique. Les documents importés et la base restent sur la machine
qui l'héberge.

**L'extraction par Claude fait exception, et c'est la seule.** Dans les modes
« Règles puis Claude » et « Claude seul », le texte des documents concernés est
transmis à l'API d'Anthropic pour y être analysé. C'est une sortie de données
hors de votre établissement : elle relève des mêmes autorisations que tout
traitement externalisé de données de santé, et elle doit être arbitrée avant
usage, pas après. En mode « Règles seules » — le mode par défaut — aucune donnée
ne quitte la machine. Sans clé API renseignée, les deux autres modes sont
indisponibles.

Ne transmettez que des documents pseudonymisés. L'application n'anonymise pas
les documents à votre place : ce qu'ils contiennent est ce qui est envoyé.

Utilisez des identifiants anonymisés comme codes de dossier — ils constituent
la clé du jeu de données exporté. Le traitement de données de santé relève par
ailleurs des obligations réglementaires applicables à votre étude.

---

## Architecture

```
server/          API Node/TypeScript, SQLite (module intégré `node:sqlite`)
  src/extract/   Un extracteur par format + service OCR
  src/engine/    Moteurs d'extraction : repliage, typage, règles, appel à Claude
                 et vérification des citations
  src/repo/      Accès aux données
  src/routes/    API HTTP
  test/          Tests unitaires et d'intégration
web/             Interface React/TypeScript (Vite)
  public/       Logo de l'établissement (déposé par vos soins)
  src/          Coquille de l'espace de travail, outils, composants
```

Le moteur d'extraction replie le texte (minuscules, sans diacritiques) tout en
conservant la correspondance des positions avec l'original : c'est ce qui
permet de chercher sans se soucier des accents **et** de citer l'extrait exact,
avec sa casse et sa ponctuation d'origine.

En production, l'API sert aussi le front compilé : un seul processus, une seule
origine.

### Tests

```bash
npm test
```

100 tests couvrent le moteur (repliage, typage, chacune des familles de règles,
négation, robustesse aux motifs invalides) et la chaîne complète — import,
extraction, correction, export — sur de vrais fichiers PDF, DOCX et DICOM
construits par les fixtures.

L'appel réseau à l'API n'est pas exercé par les tests. Ce qui l'est, c'est tout
ce qui l'entoure et qui décide de ce qui entre dans le jeu de données : le
schéma imposé au modèle, la recherche des citations dans les documents, et le
tri entre valeurs retenues et valeurs écartées.
