import { useCallback, useEffect, useRef, useState } from "react";
import { fechaLarga, periodo } from "../core/formato";
import { createSessionSlot, type SessionSlot } from "../core/sessionCaches";

/**
 * La procedencia bajo el título de un panel de la agenda, con el formato común: «IBEX 35 · Yahoo Finance · del
 * 04/11/2026 al 02/02/2027». En Modo cliente quien llama no pasa el proveedor y queda lo demás. Sin nada que decir,
 * `null`, y el panel pone su texto de siempre.
 */
export function procedenciaDelPanel(partes: ReadonlyArray<string | null | undefined>, desde?: string, hasta?: string): string | null {
  const texto = [...partes, periodo(desde, hasta)].filter(Boolean).join(" · ");
  return texto ? texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1) : null;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

/**
 * La cabecera de un día en las dos agendas (calendario y resultados), una sola forma y con año, porque el periodo
 * puede cruzar de año (ACT-13): «jueves, 13 de noviembre de 2026». Recibe el día ya en la hora local.
 */
export function cabeceraDeDia(dia: Date): string {
  return `${DIAS[dia.getDay()]}, ${fechaLarga(dia) ?? ""}`;
}

/**
 * Lo que un panel de la agenda de Mercado sabe de su carga (hallazgo 121, 04-11-2026). Antes cada
 * pestaña abría en «Pulsa Cargar», y al cambiar de pestaña se perdía lo cargado: la primera lectura
 * del IBEX tarda unos treinta segundos y volver a Dividendos la repetía.
 *
 * Ahora carga sola al abrir y se conserva mientras dure la sesión, solo en memoria. Si una carga
 * sigue en vuelo cuando se vuelve a la pestaña, se engancha a ella en vez de pedirla otra vez.
 */
interface RanuraDeAgenda<R> {
  resultado: R | null;
  enVuelo: Promise<R | null> | null;
}

export type SlotDeAgenda<R> = SessionSlot<RanuraDeAgenda<R>>;

/** Una por panel, al nivel del módulo: es lo que sobrevive a cambiar de pestaña. */
export function crearRanuraDeAgenda<R>(): SlotDeAgenda<R> {
  return createSessionSlot<RanuraDeAgenda<R>>(() => ({ resultado: null, enVuelo: null }));
}

export interface AgendaDeMercado<R> {
  resultado: R | null;
  cargando: boolean;
  error: unknown;
  recargar: () => void;
}

export function useAgendaDeMercado<R>(ranura: SlotDeAgenda<R>, cargar: () => Promise<R | null>): AgendaDeMercado<R> {
  const [resultado, setResultado] = useState<R | null>(() => ranura.read().resultado);
  const [cargando, setCargando] = useState(() => ranura.read().resultado === null);
  const [error, setError] = useState<unknown>(null);
  const montado = useRef(true);
  /* `cargar` no entra en las dependencias: es la misma función durante toda la vida del panel, y
     si cambiara no debe disparar otra llamada al proveedor. */
  const cargarRef = useRef(cargar);

  const pedir = useCallback(() => {
    setCargando(true);
    setError(null);
    const actual = ranura.read();
    const promesa =
      actual.enVuelo ??
      cargarRef.current().then(
        (nuevo) => {
          /* Se guarda aunque el panel ya no esté: es lo que evita repetir la lectura al volver. */
          ranura.write({ resultado: nuevo, enVuelo: null });
          return nuevo;
        },
        (causa: unknown) => {
          ranura.write({ resultado: ranura.read().resultado, enVuelo: null });
          throw causa;
        }
      );
    ranura.write({ ...ranura.read(), enVuelo: promesa });
    promesa
      .then((nuevo) => {
        if (montado.current) setResultado(nuevo);
      })
      .catch((causa: unknown) => {
        if (!montado.current) return;
        setResultado(null);
        setError(causa);
      })
      .finally(() => {
        if (montado.current) setCargando(false);
      });
  }, [ranura]);

  useEffect(() => {
    montado.current = true;
    if (ranura.read().resultado === null) pedir();
    return () => {
      montado.current = false;
    };
  }, [pedir, ranura]);

  return { resultado, cargando, error, recargar: pedir };
}
