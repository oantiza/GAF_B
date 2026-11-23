import type { ReactNode } from "react";
import { peso, porcentaje } from "../core/formato";
import type { CeldaDeTabla, ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import type { BdbAssetDetail } from "../types/bdbAssets";
import type { ParteSinLeer } from "../core/appError";
import { estadoDeLaPosicion, TEXTO_DEL_ESTADO } from "../core/positionsShared";
import { seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { textoDeAusencia } from "../core/textoDeAusencia";

/**
 * La tabla de Posiciones, con la pieza en vez de a mano.
 *
 * Primera pantalla que se rehace contra las piezas después de medir la hoja el
 * 03-11-2026. La medida decía dos cosas que mandan sobre cómo se hace esto:
 *
 * - La hoja no está llena de componentes que faltan, sino de **tablas escritas a
 *   mano**: 49 `<table>` en 30 ficheros, y solo cuatro pantallas usan la pieza.
 * - Lo que la pieza no sabía hacer y esta tabla sí necesitaba era poco y general: una
 *   fila de totales y una fila de detalle. Las dos entran en `TablaDeDatos`, no aquí,
 *   porque tres tablas más de la aplicación llevan `<tfoot>` propio.
 *
 * Lo que esta tabla gana al pasar por la pieza, además de perder sus 197 líneas de CSS:
 * la ordenación deja de ser suya —y con ella, el criterio de que **lo que falta va al
 * final y no se cuenta como el valor más bajo**—, y las ausencias se pintan por su
 * clase en vez de con un «N/D» plano.
 */

/** Lo que la tabla necesita de una posición. El cálculo sigue siendo de la pantalla. */
export interface PosicionCalculada {
  id: string;
  amount: number;
  weight: number;
  ongoingPct: number | null;
  costEur: number | null;
  retroPct: number | null;
  retroSourceLabel: string | null;
  cessionPct: number | null;
  incomeEur: number | null;
  /* El activo entero, no solo su nombre: los botones de la pantalla lo necesitan para
     abrir el detalle y las alternativas. */
  asset?: BdbAssetDetail | null;
  /** Lo que la base no pudo leer de ella: sin activo y con esto, «No se pudo leer», no «No reconocida». */
  sinLeer?: ParteSinLeer[];
}

/**
 * Una fila con clave propia. En el modo de extracto el MISMO ISIN puede venir dos
 * veces —son dos posiciones, no un duplicado—, así que la clave no puede ser el ISIN.
 */
export interface FilaDePosicion extends FilaAgrupable {
  id: string;
  posicion: PosicionCalculada;
}

export function filasDePosiciones(
  posiciones: PosicionCalculada[],
  porIsin: boolean
): FilaDePosicion[] {
  return posiciones.map((posicion, indice) => ({
    id: porIsin ? posicion.id : `${posicion.id}-${indice}`,
    posicion
  }));
}

const FALTA = textoDeAusencia("falta", { estrecha: true });

const cifra = (valor: number | null | undefined, escribir: (v: number) => string): CeldaDeTabla =>
  valor === null || valor === undefined || !Number.isFinite(valor)
    ? { texto: FALTA, ausencia: "falta" }
    : { texto: escribir(valor), valor };

/**
 * La casilla de una cifra que a este instrumento no le aplica, o la cifra. Una acción no tiene coste corriente ni
 * retrocesión: «N/D» en terracota se leía como un dato que nos falta, y nunca va a estar. Pregunta a la lista.
 */
function cifraSiAplica(
  metrica: MetricaDeInstrumento,
  posicion: PosicionCalculada,
  valor: number | null | undefined,
  escribir: (v: number) => string
): CeldaDeTabla {
  return seEnsenaLaMetrica(metrica, posicion.asset?.instrument_type)
    ? cifra(valor, escribir)
    : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
}

export interface OpcionesDeLaTabla {
  /** Nombre de la primera columna: «Activo» o «Fondo / ISIN» según el modo. */
  columnaDelActivo: string;
  /** Peso, coste corriente y coste anual: solo el modo extracto los enseña. */
  conCostes: boolean;
  /** Retrocesión, cesión e ingreso: nunca en modo cliente. */
  conRetro: boolean;
  /** La columna de detalle desplegable: solo el modo extracto. */
  conDetalle: boolean;
  /** Los decimales del importe: dos en los dos modos. */
  decimalesDelImporte: number;
  eur: (valor: number) => string;
  /** El botón de detalle de una fila, que la pantalla monta con su estado. */
  botonDeDetalle: (posicion: PosicionCalculada) => ReactNode;
  /** El botón de alternativas. */
  botonDeAlternativas: (posicion: PosicionCalculada) => ReactNode;
}

export function columnasDePosiciones(o: OpcionesDeLaTabla): ColumnaDeTabla<FilaDePosicion>[] {
  const columnas: ColumnaDeTabla<FilaDePosicion>[] = [
    {
      id: "activo",
      titulo: o.columnaDelActivo,
      celda: ({ posicion }) => ({
        texto: posicion.asset?.display_name ?? posicion.id,
        valor: posicion.asset?.display_name ?? posicion.id,
        apunte: posicion.id,
        /* Lo que no se ha reconocido no tiene ficha a la que ir. */
        enlaceAFicha: posicion.asset ? posicion.id : undefined
      })
    },
    {
      id: "importe",
      titulo: "Importe",
      cifra: true,
      celda: ({ posicion }) => cifra(posicion.amount, o.eur)
    }
  ];

  if (o.conCostes) {
    columnas.push(
      {
        id: "peso",
        titulo: "Peso",
        cifra: true,
        /* El peso viene en por ciento, no en tanto por uno. */
        celda: ({ posicion }) => cifra(posicion.weight, (v) => peso(v / 100) ?? "")
      },
      {
        id: "coste-corriente",
        titulo: "Coste corriente",
        cifra: true,
        celda: ({ posicion }) => cifraSiAplica("costeCorriente", posicion, posicion.ongoingPct, (v) => porcentaje(v) ?? "")
      },
      {
        id: "coste-anual",
        titulo: "Coste anual",
        cifra: true,
        celda: ({ posicion }) => cifraSiAplica("costeCorriente", posicion, posicion.costEur, o.eur)
      }
    );
  }

  if (o.conRetro) {
    columnas.push(
      {
        id: "retro",
        titulo: "Retrocesión",
        cifra: true,
        celda: ({ posicion }) => {
          const pintada = cifraSiAplica("retrocesion", posicion, posicion.retroPct, (v) => porcentaje(v / 100) ?? "");
          if (pintada.ausencia === "no-aplica") return pintada;
          /* De dónde sale la retrocesión, bajo la cifra: sin eso, una tarifa de la base
             comercial y una por defecto se leen igual. */
          return { ...pintada, apunte: posicion.retroSourceLabel ?? "Sin dato" };
        }
      },
      {
        id: "cesion",
        titulo: "Cesión",
        cifra: true,
        celda: ({ posicion }) => cifraSiAplica("retrocesion", posicion, posicion.cessionPct, (v) => porcentaje(v / 100) ?? "")
      },
      {
        id: "ingreso",
        titulo: "Ingreso",
        cifra: true,
        celda: ({ posicion }) => cifraSiAplica("retrocesion", posicion, posicion.incomeEur, o.eur)
      }
    );
  }

  columnas.push({
    id: "estado",
    titulo: "Estado",
    /* Tres estados (20-11-2026): una posición que la base no pudo leer no es una que no esté en el catálogo. Las dos
       sin activo llevan la marca de lo que falta, cada una con su palabra. */
    celda: ({ posicion }) => {
      const estado = estadoDeLaPosicion({ asset: posicion.asset ?? null, sinLeer: posicion.sinLeer });
      const texto = TEXTO_DEL_ESTADO[estado];
      return estado === "found" ? { texto, valor: texto } : { texto, valor: texto, ausencia: "falta" as const };
    }
  });

  if (o.conDetalle) {
    columnas.push({
      id: "detalle",
      titulo: "Detalle",
      acciones: true,
      celda: ({ posicion }) => ({ texto: "", nodo: o.botonDeDetalle(posicion) })
    });
  }

  columnas.push({
    id: "alternativas",
    titulo: "Alternativas",
    acciones: true,
    celda: ({ posicion }) => ({ texto: "", nodo: o.botonDeAlternativas(posicion) })
  });

  return columnas;
}

/** El pie: lo que de verdad se suma, y nada más. */
export function pieDePosiciones(
  posiciones: PosicionCalculada[],
  o: { conRetro: boolean; retroCargando: boolean; eur: (valor: number) => string }
) {
  const importe = posiciones.reduce((suma, p) => suma + p.amount, 0);
  const hayIngreso = posiciones.some((p) => p.incomeEur != null);
  const ingreso = posiciones.reduce((suma, p) => suma + (p.incomeEur ?? 0), 0);
  return (columna: ColumnaDeTabla<FilaDePosicion>): CeldaDeTabla | undefined => {
    if (columna.id === "importe") return { texto: o.eur(importe) };
    if (columna.id === "ingreso" && o.conRetro) {
      if (o.retroCargando) return { texto: "Cargando…" };
      return hayIngreso ? { texto: o.eur(ingreso) } : { texto: FALTA, ausencia: "falta" };
    }
    /* El resto no se suma: un peso medio o un coste corriente medio no son un total, y
       ponerlos en la fila de totales los convertiría en uno a los ojos de quien lee. */
    return undefined;
  };
}
