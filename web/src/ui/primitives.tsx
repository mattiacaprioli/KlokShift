// Primitive della dashboard. Volutamente poche e generiche: il design system
// vero è quello dell'app (src/components/ui), qui servono le forme da scrivania
// — tabelle dense, campi, pannelli — che sul mobile non esistono.

import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  OptionHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function Button({
  variant = "ghost",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "gold" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        "focus-gold inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        variant === "gold" &&
          "bg-gold text-gold-ink hover:bg-gold-light active:bg-gold-dark",
        variant === "ghost" &&
          "border border-border-2 bg-bg-2 text-t1 hover:bg-bg-3",
        variant === "danger" &&
          "border border-error/40 bg-error/10 text-error hover:bg-error/20",
        className
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: PropsWithChildren<{ label: string; hint?: string; error?: string }>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-error">{error}</span>
      ) : hint ? (
        <span className="text-xs text-t4">{hint}</span>
      ) : null}
    </label>
  );
}

const controlClass =
  "focus-gold w-full rounded-xl border border-border-2 bg-bg-1 px-3 py-2 text-sm text-t1 placeholder:text-t4";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />;
}

/**
 * Campo password con l'occhio. Su desktop si digita alla cieca una password
 * lunga senza il correttore del telefono ad aiutare: poterla rileggere prima
 * di inviare è la differenza fra entrare e riprovare.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        className={cn(controlClass, "pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        // Il campo resta l'elemento da tabulare: l'occhio è un di più, e
        // intercettarlo col Tab rallenterebbe chi compila da tastiera.
        tabIndex={-1}
        aria-label={revealed ? "Nascondi la password" : "Mostra la password"}
        className={cn(
          "focus-gold absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-xl transition",
          revealed ? "text-gold" : "text-t4 hover:text-t2"
        )}
      >
        <EyeIcon off={revealed} />
      </button>
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {off ? (
        <>
          <path d="M10.7 6.1A9.9 9.9 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a18 18 0 0 1-2.9 3.6M6.5 7.6A17.6 17.6 0 0 0 2 12s3.8 6.5 10 6.5a9.6 9.6 0 0 0 3.9-.8" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="M3 3l18 18" />
        </>
      ) : (
        <>
          <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  value: string;
};

/**
 * Select da scrivania con il menu ancorato sotto al controllo.
 *
 * Il popup di un `<select>` nativo non è posizionabile via CSS: macOS lo
 * centra sull'opzione corrente e finisce per coprire il campo. Il select vero
 * resta nascosto per form, ref ed eventi; il menu visibile è nostro e quindi
 * parte sempre otto pixel sotto al pulsante.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select(
  {
    children,
    className,
    disabled,
    value,
    defaultValue,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...selectProps
  },
  forwardedRef
) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    String(defaultValue ?? "")
  );
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 256,
  });

  const options = useMemo<SelectOption[]>(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (
          !isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child) ||
          child.type !== "option"
        ) {
          return [];
        }
        const optionValue = String(child.props.value ?? "");
        return [
          {
            disabled: !!child.props.disabled,
            label: child.props.children,
            value: optionValue,
          },
        ];
      }),
    [children]
  );

  const selectedValue = String(value ?? uncontrolledValue);
  const selected = options.find((option) => option.value === selectedValue);

  function setNativeRef(node: HTMLSelectElement | null) {
    nativeRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 8;
    const width = Math.max(rect.width, 160);
    setMenuPosition({
      left: Math.max(
        gutter,
        Math.min(rect.left, window.innerWidth - width - gutter)
      ),
      top: rect.bottom + gutter,
      width,
      maxHeight: Math.max(96, window.innerHeight - rect.bottom - gutter * 2),
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function choose(next: string) {
    const native = nativeRef.current;
    if (!native) return;
    setUncontrolledValue(next);
    // Il setter nativo, seguito da un vero `change`, mantiene compatibili sia
    // gli onChange React sia react-hook-form senza inventare un finto evento.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    setter?.call(native, next);
    native.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(direction: 1 | -1) {
    if (options.length === 0) return;
    let next = activeIndex;
    do {
      next = (next + direction + options.length) % options.length;
    } while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
  }

  function openMenu() {
    const current = options.findIndex(
      (option) => option.value === selectedValue && !option.disabled
    );
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(current >= 0 ? current : Math.max(0, firstEnabled));
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option && !option.disabled) choose(option.value);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          controlClass,
          "flex cursor-pointer items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "Seleziona…"}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
          className={cn("shrink-0 text-t4 transition", open && "rotate-180")}
        >
          <path d="m3 6 5 5 5-5" />
        </svg>
      </button>

      <select
        ref={setNativeRef}
        hidden
        tabIndex={-1}
        disabled={disabled}
        value={value}
        defaultValue={value == null ? defaultValue : undefined}
        aria-hidden="true"
        {...selectProps}
      >
        {children}
      </select>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
              className="fixed z-50 overflow-y-auto rounded-xl border border-border-2 bg-bg-card p-1 shadow-xl"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              {options.map((option, index) => (
                <div
                  key={`${option.value}-${index}`}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={option.value === selectedValue}
                  aria-disabled={option.disabled || undefined}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => !option.disabled && choose(option.value)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm text-t1",
                    option.disabled
                      ? "cursor-not-allowed opacity-40"
                      : "cursor-pointer",
                    index === activeIndex && !option.disabled && "bg-bg-3",
                    option.value === selectedValue && "font-semibold text-gold"
                  )}
                >
                  {option.label}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
});

export function Textarea({
  className,
  ...props
}: InputHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlClass, "min-h-20 resize-y", className)}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border-2 bg-bg-card p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  /** Testo, o un frammento: il Planning ci appende l'avviso sui turni scoperti. */
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 print:mb-3">
      <div>
        <h1 className="font-serif text-2xl text-t1">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-t3">{subtitle}</p>
        ) : null}
      </div>
      {/* Titolo e sottotitolo (settimana, mese) servono anche sul foglio; i
          comandi no: su carta non si clicca niente. */}
      {actions ? (
        <div className="flex gap-2 print:hidden">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * Tiene fermo in cima quello che contiene (titolo, comandi, filtri) mentre la
 * pagina scorre sotto.
 *
 * Il margine negativo copre il padding di `<main>`, così le righe non si vedono
 * passare sopra il titolo; `flow-root` tiene dentro lo sfondo il margine in
 * fondo all'ultimo figlio (il `mb-6` di `PageHeader`) invece di farlo
 * collassare fuori, dove le righe spunterebbero nella fessura.
 */
export function StickyHeader({ children }: PropsWithChildren) {
  return (
    <div className="sticky top-0 z-10 -mx-8 -mt-8 flow-root bg-bg-0 px-8 pt-8 print:static print:m-0 print:p-0">
      {children}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: PropsWithChildren<{
  tone?: "neutral" | "gold" | "success" | "warning" | "error";
}>) {
  return (
    <span
      className={cn(
        // In stampa il browser non riempie gli sfondi: senza un bordo la pill
        // perderebbe la sua forma e resterebbe testo in mezzo ad altro testo.
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold print:border print:border-border-2",
        tone === "neutral" && "bg-bg-3 text-t2",
        tone === "gold" && "bg-gold/15 text-gold",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "error" && "bg-error/15 text-error"
      )}
    >
      {children}
    </span>
  );
}

/** Stato vuoto/errore/caricamento uniforme: la dashboard non deve mai "sparire". */
export function Placeholder({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-t2">{title}</p>
      {detail ? <p className="max-w-md text-xs text-t4">{detail}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = "Caricamento…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-t3">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-border-2 border-t-gold"
      />
      {label}
    </div>
  );
}

/** Errore di query, con il messaggio reale: serve a diagnosticare la RLS. */
export function QueryError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-2xl border border-error/40 bg-error/10 p-4 text-sm text-error">
      <p className="font-semibold">Errore nel caricamento</p>
      <p className="mt-1 text-xs opacity-80">{message}</p>
    </div>
  );
}
