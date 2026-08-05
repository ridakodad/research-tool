import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconAlert, IconAuto, IconClose, IconMoon, IconSun } from './icons';

// ------------------------------------------------------------------- toasts

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    // Les messages d'erreur restent affichés plus longtemps : ils demandent
    // souvent une action de l'utilisateur.
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, kind === 'error' ? 8000 : 4000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans un ToastProvider.');
  return ctx;
}

// -------------------------------------------------------------------- modal

export function Modal({
  title,
  children,
  onClose,
  footer,
  width,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Empêche le défilement de la page derrière la fenêtre modale.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Une fenêtre s'ouvre toujours à son premier champ. Le navigateur peut
  // l'avoir fait défiler en amenant le champ initial dans la vue : cet effet
  // s'exécute après, et rétablit le haut.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn-icon" onClick={onClose} aria-label="Fermer">
            <IconClose size={18} />
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- divers

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span className="small secondary">{label}</span>}
    </span>
  );
}

export function LoadingPanel({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="card">
      <div className="card-body">
        <Spinner label={label} />
      </div>
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error">
      <IconAlert size={18} />
      <div style={{ flex: 1 }}>
        <div>{message}</div>
        {onRetry && (
          <button className="btn-sm" style={{ marginTop: 8 }} onClick={onRetry}>
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Demande une confirmation avant une action destructive. */
export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = 'Confirmer ?',
  className = 'btn-sm btn-danger',
  title,
}: {
  onConfirm: () => void;
  label: ReactNode;
  confirmLabel?: string;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    // La confirmation retombe d'elle-même : pas de bouton dangereux laissé armé.
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      className={className}
      title={title}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Éditeur de liste de chaînes (options, libellés, mots-clés). */
export function StringListEditor({
  values,
  onChange,
  placeholder,
  ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (value.length === 0 || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: values.length > 0 ? 8 : 0 }}>
        {values.map((value, i) => (
          <span key={`${value}-${i}`} className="badge">
            {value}
            <button
              className="btn-icon"
              style={{ border: 'none', background: 'none', padding: '0 0 0 2px' }}
              onClick={() => onChange(values.filter((_, index) => index !== i))}
              aria-label={`Retirer ${value}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          type="text"
          value={draft}
          aria-label={ariaLabel ?? 'Nouvelle valeur'}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn-sm" onClick={add} disabled={draft.trim().length === 0}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

/** Bascule clair / sombre, mémorisée d'une session à l'autre. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark' | 'auto') ?? 'auto',
  );

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  const Icon = theme === 'auto' ? IconAuto : theme === 'light' ? IconSun : IconMoon;
  const labels = { auto: 'Thème système', light: 'Thème clair', dark: 'Thème sombre' };

  return (
    <button
      className="btn-icon"
      onClick={() => setTheme(next)}
      title={labels[theme]}
      aria-label={labels[theme]}
    >
      <Icon size={18} />
    </button>
  );
}
