import type { KeyboardEvent } from "react";

export interface SegmentedControlOption<T extends string | number> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  buttonClassName?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = "",
  buttonClassName = ""
}: SegmentedControlProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    const enabledOptions = options.filter((option) => !option.disabled);
    const currentId = options[currentIndex]?.id;
    const enabledIndex = enabledOptions.findIndex((option) => option.id === currentId);
    let nextIndex: number;

    if (event.key === "ArrowRight") nextIndex = (enabledIndex + 1) % enabledOptions.length;
    else if (event.key === "ArrowLeft") nextIndex = (enabledIndex - 1 + enabledOptions.length) % enabledOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else nextIndex = enabledOptions.length - 1;

    /* MAR-15: un solo patrón, botones `aria-pressed`. Las flechas, Inicio y Fin mueven el foco; el valor cambia al
       pulsar. Antes cambiaban el valor como en un grupo de opciones, y el lector anunciaba otra cosa. */
    event.preventDefault();
    const nextOption = enabledOptions[nextIndex];
    if (!nextOption) return;
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-segment-id="${String(nextOption.id)}"]`)
      ?.focus();
  };

  return (
    <div className={`ui-segmented ${className}`.trim()} role="group" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            data-segment-id={String(option.id)}
            className={`ui-segmented__button${selected ? " active" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
