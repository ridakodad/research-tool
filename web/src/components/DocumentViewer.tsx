import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ConfirmButton, ErrorPanel, Modal, Spinner } from './ui';
import { IconAlert } from './icons';
import type { DocumentMeta, Evidence } from '../lib/types';

/**
 * Lecteur de documents, affiché à côté de la fiche pendant la relecture.
 *
 * La relecture consiste à confronter une valeur au document qui la justifie.
 * Tant que le document s'ouvrait dans une fenêtre modale, il fallait fermer
 * pour saisir puis rouvrir pour vérifier la variable suivante. Le lecteur
 * reste donc à l'écran, et suit la fiche : cliquer sur la justification d'une
 * variable l'amène sur le bon document, à la bonne ligne.
 */

type Mode = 'apercu' | 'texte';

/**
 * Le serveur décide seul de ce qu'il accepte d'afficher dans la page, et le
 * calcule sur le nom de stockage. Le client s'y range plutôt que de rejouer la
 * règle sur un nom d'affichage que l'utilisateur peut avoir renommé.
 */
function hasNativePreview(doc: DocumentMeta): boolean {
  return doc.previewable;
}

function isPdf(doc: DocumentMeta): boolean {
  return doc.kind === 'pdf';
}

export interface ViewerFocus {
  documentId: number;
  evidence: Evidence;
  /** Change à chaque clic, même sur la même justification, pour rejouer le défilement. */
  nonce: number;
}

export function DocumentViewer({
  documents,
  focus,
  onReparse,
  onDelete,
  onAdd,
  onRenamed,
}: {
  documents: DocumentMeta[];
  focus: ViewerFocus | null;
  onReparse: (doc: DocumentMeta) => void;
  onDelete: (doc: DocumentMeta) => void;
  onAdd: () => void;
  onRenamed: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(documents[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>('apercu');
  const [enlarged, setEnlarged] = useState(false);
  /** Document en cours de renommage. Aucun bouton dédié : le nom se modifie
      sur place, au double-clic sur son onglet. */
  const [renaming, setRenaming] = useState<number | null>(null);

  const selected = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

  // Le document sélectionné peut disparaître (suppression) : on retombe sur le
  // premier plutôt que d'afficher un panneau vide.
  useEffect(() => {
    if (documents.length === 0) setSelectedId(null);
    else if (!documents.some((d) => d.id === selectedId)) setSelectedId(documents[0]!.id);
  }, [documents, selectedId]);

  // Le mode suit le format : un DOCX n'a pas d'aperçu, son texte est tout ce
  // qu'il y a à voir.
  useEffect(() => {
    if (selected && !hasNativePreview(selected)) setMode('texte');
  }, [selected]);

  /*
   * Une justification cliquée dans la fiche amène ici. On montre alors le
   * document lui-même — c'est le scan ou la photo que le relecteur veut voir,
   * pas sa transcription. La citation s'affiche au-dessus, et reste
   * consultable dans le texte extrait d'un clic pour qui veut la position
   * exacte. Les formats sans aperçu n'ont que leur texte à offrir.
   */
  useEffect(() => {
    if (!focus) return;
    setSelectedId(focus.documentId);
    const target = documents.find((d) => d.id === focus.documentId);
    if (target && !hasNativePreview(target)) setMode('texte');
    else setMode('apercu');
  }, [focus, documents]);

  if (documents.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Documents</h2>
        </div>
        <div className="empty-state">
          <h3>Aucun document</h3>
          <p>Les documents importés ici alimentent l'extraction et servent de référence à la relecture.</p>
          <button className="btn-primary btn-sm" onClick={onAdd}>
            Ajouter des documents
          </button>
        </div>
      </div>
    );
  }

  if (!selected) return null;

  return (
    <>
      <div className="card doc-panel">
        <div className="card-head" style={{ gap: 8 }}>
          <h2>Documents</h2>
          <span className="sub">{documents.length}</span>
          <div className="card-actions">
            <button className="btn-sm" onClick={onAdd}>
              Ajouter
            </button>
          </div>
        </div>

        {/* Sélection du document : une puce par fichier, l'onglet courant marqué. */}
        <div className="doc-tabs" role="tablist" aria-label="Documents du dossier">
          {documents.map((doc) => (
            renaming === doc.id ? (
              <RenameField
                key={doc.id}
                doc={doc}
                onDone={() => {
                  setRenaming(null);
                  onRenamed();
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <button
                key={doc.id}
                role="tab"
                aria-selected={doc.id === selected.id}
                className={doc.id === selected.id ? 'doc-tab active' : 'doc-tab'}
                onClick={() => setSelectedId(doc.id)}
                onDoubleClick={() => setRenaming(doc.id)}
                title={`${doc.filename} — double-cliquer pour renommer`}
              >
                <span className="truncate">{doc.filename}</span>
                {doc.parseStatus !== 'ok' && (
                  <span className="doc-tab-flag" title="Aucun texte exploitable" aria-hidden="true" />
                )}
              </button>
            )
          ))}
        </div>

        <ViewerToolbar
          doc={selected}
          mode={mode}
          onMode={setMode}
          onEnlarge={() => setEnlarged(true)}
        />

        {/* La citation qui a motivé la valeur, gardée sous les yeux pendant
            qu'on regarde le document d'où elle vient. */}
        {focus && focus.documentId === selected.id && (
          <div className="doc-quote">
            <span className="doc-quote-text">« {focus.evidence.snippet} »</span>
            {mode !== 'texte' && (
              <button className="btn-sm" onClick={() => setMode('texte')}>
                Situer dans le texte
              </button>
            )}
          </div>
        )}

        <div className="doc-body">
          <ViewerBody doc={selected} mode={mode} focus={focus} />
        </div>

        <div className="doc-foot">
          <span className="small muted">{formatBytes(selected.size)}</span>
          <div className="spacer" />
          <a
            className="btn btn-sm"
            href={api.documentFileUrl(selected.id)}
            target="_blank"
            rel="noreferrer"
          >
            Ouvrir le fichier
          </a>
          <button
            className="btn-sm btn-quiet"
            onClick={() => setRenaming(selected.id)}
            title="Donner un nom parlant à ce document"
          >
            Renommer
          </button>
          <button
            className="btn-sm btn-quiet"
            onClick={() => onReparse(selected)}
            title="Relancer l'analyse du fichier"
          >
            Ré-analyser
          </button>
          <ConfirmButton
            label="Supprimer"
            confirmLabel="Confirmer"
            onConfirm={() => onDelete(selected)}
          />
        </div>
      </div>

      {enlarged && (
        <Modal title={selected.filename} onClose={() => setEnlarged(false)} width={1240}>
          <div className="doc-enlarged">
            <ViewerBody doc={selected} mode={mode} focus={focus} />
          </div>
        </Modal>
      )}
    </>
  );
}

function ViewerToolbar({
  doc,
  mode,
  onMode,
  onEnlarge,
}: {
  doc: DocumentMeta;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onEnlarge: () => void;
}) {
  const native = hasNativePreview(doc);
  return (
    <div className="doc-toolbar">
      <div className="row" style={{ gap: 4 }}>
        <button
          className={mode === 'apercu' ? 'btn-primary btn-sm' : 'btn-sm'}
          onClick={() => onMode('apercu')}
          disabled={!native}
          title={native ? undefined : "Ce format n'a pas d'aperçu dans le navigateur"}
        >
          Aperçu
        </button>
        <button
          className={mode === 'texte' ? 'btn-primary btn-sm' : 'btn-sm'}
          onClick={() => onMode('texte')}
        >
          Texte extrait
        </button>
      </div>
      <div className="spacer" />
      <button className="btn-sm" onClick={onEnlarge} title="Afficher en grand">
        Agrandir
      </button>
    </div>
  );
}

function ViewerBody({
  doc,
  mode,
  focus,
}: {
  doc: DocumentMeta;
  mode: Mode;
  focus: ViewerFocus | null;
}) {
  if (mode === 'apercu' && hasNativePreview(doc)) {
    if (isPdf(doc)) {
      /* `object` plutôt que `iframe` : quand le navigateur ne sait pas rendre
         le PDF, il affiche le contenu de repli au lieu d'un cadre vide. */
      return (
        <object
          className="doc-frame"
          data={api.documentFileUrl(doc.id)}
          type="application/pdf"
          aria-label={`Aperçu de ${doc.filename}`}
        >
          <div style={{ padding: 16 }}>
            <div className="notice notice-info">
              <IconAlert size={18} />
              <div>
                Ce navigateur n'affiche pas les PDF dans la page.{' '}
                <a href={api.documentFileUrl(doc.id)} target="_blank" rel="noreferrer">
                  Ouvrir le fichier dans un onglet
                </a>
                , ou consultez le texte extrait.
              </div>
            </div>
          </div>
        </object>
      );
    }
    return <ImagePreview doc={doc} />;
  }
  return <TextPreview doc={doc} focus={focus} />;
}

/**
 * Aperçu d'image avec agrandissement.
 *
 * Une photo de compte rendu est souvent illisible à la largeur du panneau :
 * il faut pouvoir grossir et se déplacer dans l'image sans quitter la fiche.
 */
function ImagePreview({ doc }: { doc: DocumentMeta }) {
  const [zoom, setZoom] = useState(100);

  // Repartir de la largeur ajustée en changeant de document : le grossissement
  // choisi pour l'un n'a pas de sens pour le suivant.
  useEffect(() => setZoom(100), [doc.id]);

  const step = (delta: number) => setZoom((z) => Math.min(500, Math.max(50, z + delta)));

  return (
    <div className="doc-image-wrap">
      <div className="doc-zoom">
        <button className="btn-sm" onClick={() => step(-25)} disabled={zoom <= 50} aria-label="Réduire">
          −
        </button>
        <span className="small mono" style={{ minWidth: 46, textAlign: 'center' }}>
          {zoom} %
        </span>
        <button className="btn-sm" onClick={() => step(25)} disabled={zoom >= 500} aria-label="Agrandir">
          +
        </button>
        <button className="btn-sm" onClick={() => setZoom(100)} disabled={zoom === 100}>
          Ajuster
        </button>
      </div>
      <div className="doc-image-scroll">
        <img
          src={api.documentFileUrl(doc.id)}
          alt={doc.filename}
          style={{ width: `${zoom}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Texte réellement extrait, avec la citation mise en évidence.
 *
 * C'est la vue qui explique un échec d'extraction : si le texte est vide ou
 * mal reconnu, la règle ne pouvait rien trouver.
 */
function TextPreview({ doc, focus }: { doc: DocumentMeta; focus: ViewerFocus | null }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    api
      .getDocumentText(doc.id)
      .then((r) => !cancelled && setText(r.text))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  const range = useMemo(() => {
    if (text === null || !focus || focus.documentId !== doc.id) return null;
    return locateEvidence(text, focus.evidence);
  }, [text, focus, doc.id]);

  // Amener la citation sous les yeux, une fois le texte rendu.
  useEffect(() => {
    if (!range || !markRef.current) return;
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    markRef.current.scrollIntoView({
      behavior: motionOk ? 'smooth' : 'auto',
      block: 'center',
    });
  }, [range, focus?.nonce]);

  if (error) return <ErrorPanel message={error} />;
  if (text === null) {
    return (
      <div style={{ padding: 16 }}>
        <Spinner label="Chargement du texte…" />
      </div>
    );
  }

  if (text.trim().length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div className="notice notice-warn">
          <IconAlert size={18} />
          <div>
            Aucun texte n'a pu être extrait de ce document. C'est le cas des PDF scannés sans
            couche texte et des images lorsque la reconnaissance optique est indisponible. Les
            variables correspondantes devront être saisies à la main.
          </div>
        </div>
      </div>
    );
  }

  return (
    <pre className="doc-text">
      {range ? (
        <>
          {text.slice(0, range.start)}
          <mark className="doc-mark" ref={markRef}>
            {text.slice(range.start, range.end)}
          </mark>
          {text.slice(range.end)}
        </>
      ) : (
        text
      )}
    </pre>
  );
}

/**
 * Retrouve la citation dans le texte affiché.
 *
 * Les positions enregistrées lors de l'extraction peuvent avoir vieilli : le
 * document a pu être ré-analysé depuis, avec un texte légèrement différent.
 * On les vérifie donc avant de s'y fier, et on retombe sur une recherche de
 * l'extrait quand elles ne correspondent plus.
 */
export function locateEvidence(
  text: string,
  evidence: Evidence,
): { start: number; end: number } | null {
  const { start, end, snippet } = evidence;

  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length) {
    const atPosition = text.slice(start, end);
    if (atPosition.trim().length > 0 && snippet.includes(atPosition.trim())) {
      return { start, end };
    }
  }

  // `makeSnippet` encadre la correspondance de points de suspension : on ne
  // garde que le corps pour la recherche de repli.
  const core = snippet.replace(/^…\s*/, '').replace(/\s*…$/, '').trim();
  if (core.length === 0) return null;
  const found = text.indexOf(core);
  return found === -1 ? null : { start: found, end: found + core.length };
}

/**
 * Renommage sur place.
 *
 * Le nom d'un document est une étiquette de travail : « CR opératoire » se
 * relit mieux que « IMG_2381 » sur trente dossiers. Le fichier, son empreinte
 * et son texte extrait ne bougent pas — renommer ne peut donc invalider ni une
 * extraction ni une justification.
 */
function RenameField({
  doc,
  onDone,
  onCancel,
}: {
  doc: DocumentMeta;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(doc.filename);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const name = value.trim();
    if (name.length === 0 || name === doc.filename) return onCancel();
    setSaving(true);
    try {
      await api.renameDocument(doc.id, name);
      onDone();
    } catch {
      // L'échec laisse le nom d'origine : rien n'est perdu.
      onCancel();
    }
  };

  return (
    <input
      className="doc-tab-input"
      autoFocus
      disabled={saving}
      value={value}
      aria-label={`Nouveau nom pour ${doc.filename}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}
