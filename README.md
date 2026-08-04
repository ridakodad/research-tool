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

**3. Extraire.** Une passe applique la fiche à tous les dossiers. Chaque valeur
trouvée conserve **le document et l'extrait qui la justifient**.

**4. Relire.** Dossier par dossier, chaque variable affiche son origine
(automatique ou vérifiée), sa confiance, et sa justification. Une valeur
corrigée à la main est marquée comme telle et **n'est jamais écrasée** par une
extraction ultérieure.

**5. Analyser et exporter.** Tableau brut, distributions par variable, taux de
remplissage, export CSV et dictionnaire des variables.

---

## Démarrage

```bash
npm install          # Node 20 ou plus récent
npm run build
npm start            # http://localhost:4000
```

En développement (front et API séparés, rechargement à chaud) :

```bash
npm run dev          # front sur 5173, API sur 4000
```

Pour découvrir l'application avec des données factices :

```bash
npm run demo --workspace server -- --upload
```

Cela crée 24 dossiers patients synthétiques dans `data/demo/` et les importe.
Sans `--upload`, les fichiers sont seulement écrits sur le disque et vous
pouvez les glisser dans l'interface pour essayer l'import.

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

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | Port de l'API |
| `DATA_DIR` | `./data` | Base SQLite et fichiers importés |
| `DB_PATH` | `$DATA_DIR/research-tool.db` | Emplacement de la base |
| `MAX_UPLOAD_BYTES` | `200 Mo` | Taille maximale d'un fichier |
| `CORS_ORIGINS` | `localhost:5173` | Origines autorisées (développement) |

Les documents importés sont conservés tels quels sous `DATA_DIR/uploads/`, sous
un nom généré ; le nom d'origine reste affiché dans l'interface.

---

## Données personnelles

L'application ne comporte ni authentification ni chiffrement : elle est prévue
pour un poste de travail ou un serveur d'établissement maîtrisé, pas pour une
exposition publique. Les documents importés et la base restent sur la machine
qui l'héberge, aucune donnée ne sort vers un service tiers.

Utilisez des identifiants anonymisés comme codes de dossier — ils constituent
la clé du jeu de données exporté. Le traitement de données de santé relève par
ailleurs des obligations réglementaires applicables à votre étude.

---

## Architecture

```
server/          API Node/TypeScript, SQLite (better-sqlite3)
  src/extract/   Un extracteur par format + service OCR
  src/engine/    Moteur de règles : repliage, typage, application
  src/repo/      Accès aux données
  src/routes/    API HTTP
  test/          Tests unitaires et d'intégration
web/             Interface React/TypeScript (Vite)
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

82 tests couvrent le moteur (repliage, typage, chacune des familles de règles,
négation, robustesse aux motifs invalides) et la chaîne complète — import,
extraction, correction, export — sur de vrais fichiers PDF, DOCX et DICOM
construits par les fixtures.
