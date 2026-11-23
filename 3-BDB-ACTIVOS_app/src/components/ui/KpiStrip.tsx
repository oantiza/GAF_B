import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * La tira de cifras destacadas: la cifra a 32 px en la serifa de la dirección A, peso 600 y en tinta, con cualquier
 * signo.
 *
 * Una cifra financiera no es buena ni mala por sí misma, así que la tira no la pinta por su
 * signo. Hay un tono, y no opina sobre una cifra:
 *
 * - `warn`: un estado que avisa, con su palabra al lado de la señal («Vigilar»). En el ocre del aviso.
 *
 * Lo que va sin dígitos («No aplica», «Falta el dato») baja a 17 px y a la letra del texto, porque no es una cifra
 * y no debe competir con las que tiene al lado.
 */
export interface KpiStripItem {
  label: ReactNode;
  value: ReactNode;
  /** `warn`. Sin él, tinta: es lo normal. */
  tone?: string;
  /** La línea bajo la cifra, cuando el rótulo no basta para saber de qué es. */
  note?: ReactNode;
}

interface KpiStripProps {
  items: readonly KpiStripItem[];
  ariaLabel?: string;
  className?: string;
  /**
   * La tira lleva importes en euros. Un importe es más largo que un porcentaje —«1.234.567 €» mide 5,10 em y
   * «+12.936.757 €», 6,17—, así que en estas tiras la cifra mengua con su columna según lo larga que sea la cifra más
   * larga de la tira: ninguna se parte ni se sale de su casilla, sea de siete cifras, de ocho o con signo (la regla
   * está en `components.css`, con su cuenta).
   */
  importes?: boolean;
}

export function KpiStrip({
  items,
  ariaLabel,
  className = "",
  importes = false
}: KpiStripProps) {
  const classes = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ");
  const tira = useRef<HTMLDivElement>(null);
  /* En una tira de importes, cuántos caracteres tiene la cifra más larga: la hoja hace menguar todas las de la tira
     a la vez, para que la más larga quepa y las hermanas no salgan a tamaños distintos. Se cuenta lo pintado, porque
     la cifra llega ya compuesta (`Cifra`); lo que va sin dígitos («Falta el dato») no cuenta: no es una cifra. */
  useLayoutEffect(() => {
    const elemento = tira.current;
    if (!importes || !elemento) return;
    const largo = Math.max(
      0,
      ...Array.from(elemento.querySelectorAll(".ui-kpi__value"), (valor) => (valor.textContent ?? "").trim())
        .filter((texto) => /\d/.test(texto))
        .map((texto) => texto.length)
    );
    if (largo > 0) elemento.style.setProperty("--kpi-caracteres", String(largo));
    else elemento.style.removeProperty("--kpi-caracteres");
  });
  /* Una cifra cabe a 32 px en una tarjeta estrecha (y en una muy estrecha mengua con su columna); una palabra como
     «No aplica» o «Falta el dato», no: se partía por la mitad. Los valores sin dígitos bajan
     un escalón de tamaño. */
  const isTextValue = (value: ReactNode) => typeof value === "string" && !/\d/.test(value);

  return (
    <div ref={tira} className={classes("ui-kpi-strip", importes ? "ui-kpi-strip--importes" : undefined, className)} aria-label={ariaLabel} role={ariaLabel ? "region" : undefined}>
      {items.map((item, index) => (
        <div key={`${String(item.label)}-${index}`} className="ui-kpi">
          <span className="ui-kpi__label">{item.label}</span>
          <strong className={classes("ui-kpi__value", isTextValue(item.value) ? "ui-kpi__value--text" : undefined, item.tone)}>{item.value}</strong>
          {item.note ? <span className="ui-kpi__note">{item.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
