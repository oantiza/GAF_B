import type { KeyboardEvent, ReactNode } from "react";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedTabsProps<T extends string> {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  idPrefix: string;
  className?: string;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className = ""
}: SegmentedTabsProps<T>) {
  const focusTab = (tabId: T) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-tab-${tabId}`)?.focus();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const currentId = tabs[currentIndex]?.id;
    const enabledIndex = enabledTabs.findIndex((tab) => tab.id === currentId);
    let nextIndex: number;

    if (event.key === "ArrowRight") nextIndex = (enabledIndex + 1) % enabledTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (enabledIndex - 1 + enabledTabs.length) % enabledTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = enabledTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = enabledTabs[nextIndex];
    if (!nextTab) return;
    onChange(nextTab.id);
    focusTab(nextTab.id);
  };

  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            id={`${idPrefix}-tab-${tab.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            className={`ui-tab${selected ? " active" : ""}`}
            disabled={tab.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

interface PanelDePestanaProps<T extends string> {
  /** El mismo `idPrefix` que sus `SegmentedTabs`. */
  idPrefix: string;
  /** La pestaña de la que es panel. */
  pestana: T;
  /**
   * Lo pone en el orden del tabulador (`tabIndex={0}`). Solo cuando el panel no empieza por algo que se pueda enfocar:
   * si no, quien llega con el tabulador desde la pestaña no tiene adónde ir para leerlo.
   */
  enfocable?: boolean;
  /** Para un panel que se queda montado aunque no sea el elegido: lo oculta sin desmontarlo. */
  hidden?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * El panel de una pestaña: su `id`, su `role="tabpanel"` y su `aria-labelledby`, enlazados con los de `SegmentedTabs`
 * por el mismo `idPrefix`. Cada pantalla los escribía a mano (`id={`gestor-panel-${vista}`}`…), y bastaba con que
 * uno de los dos lados cambiara el prefijo para que la pestaña dejara de nombrar a su panel sin que nada fallara.
 *
 * ```tsx
 * <SegmentedTabs idPrefix="analisis" tabs={pestanas} value={pestana} onChange={setPestana} label="Secciones" />
 * <PanelDePestana idPrefix="analisis" pestana={pestana}>…</PanelDePestana>
 * ```
 */
export function PanelDePestana<T extends string>({ idPrefix, pestana, enfocable = false, hidden, className, children }: PanelDePestanaProps<T>) {
  return (
    <div
      aria-labelledby={`${idPrefix}-tab-${pestana}`}
      className={className}
      hidden={hidden}
      id={`${idPrefix}-panel-${pestana}`}
      role="tabpanel"
      tabIndex={enfocable ? 0 : undefined}
    >
      {children}
    </div>
  );
}
