/**
 * Los datos de mercado de una cartera y su análisis para un periodo.
 *
 * El mercado se vuelve a pedir solo cuando cambia lo que hace falta pedir (los activos, la
 * primera fecha, la referencia), no en cada movimiento. La valoración diaria se
 * rehace cuando cambia la cartera o llegan los datos; el análisis de un periodo, cuando
 * cambia el periodo. Todo ocurre en el equipo: de aquí solo salen los ISIN.
 */
import { useEffect, useMemo, useState } from "react";
import { demostracion, esDemostracion } from "../../demo/carteraDemo";
import { cargarMercado, motivoEnLlano, type MercadoCargado } from "../../mercado/cargar";
import { HAY_PLATAFORMA, fuenteDeLaPlataforma } from "../../mercado/plataforma";
import { analizar, periodosHabituales, preparar, type Analisis, type IdDePeriodo, type PeriodoHabitual, type Preparado } from "../../motor/analisis";
import type { Dia } from "../../motor/fechas";
import type { Cartera } from "../../motor/modelo";
import { serieDeLaReferencia, type EntradaDeReferencia } from "../../motor/referencia";
import { tramoDe, type Periodo } from "../../motor/rentabilidad";

const MERCADO_VACIO: MercadoCargado = { datos: { precios: new Map(), cambios: new Map() }, fichas: new Map(), avisos: [] };

export interface MercadoDeCartera {
  mercado: MercadoCargado;
  cargando: boolean;
  error: string | null;
  /** Vuelve a pedir los datos (tras un fallo de red, por ejemplo). */
  reintentar(): void;
}

/** Lo que determina qué hay que pedir a la plataforma: si no cambia, no se vuelve a pedir. */
export function huellaDeLoQueSePide(cartera: Cartera, hasta: Dia): string {
  const primera = cartera.movimientos.reduce<string | undefined>((minima, movimiento) => (minima === undefined || movimiento.fechaOperacion < minima ? movimiento.fechaOperacion : minima), undefined);
  /* El primer año de cada activo: la carga pide sus precios desde el anterior (`cargar.ts`), así que si cambia hay que volver a pedir. */
  const usados = new Map<string, string>();
  const divisas = new Set<string>();
  for (const movimiento of cartera.movimientos) {
    const anio = movimiento.fechaOperacion.slice(0, 4);
    for (const activoId of [movimiento.activoId, movimiento.destino?.activoId]) {
      if (!activoId) continue;
      const previo = usados.get(activoId);
      if (previo === undefined || anio < previo) usados.set(activoId, anio);
    }
    if (movimiento.divisa) divisas.add(movimiento.divisa);
    if (movimiento.destino?.divisa) divisas.add(movimiento.destino.divisa);
  }
  const activos = cartera.activos
    .filter((activo) => usados.has(activo.id))
    .map((activo) => `${activo.id}:${activo.origen}:${activo.isin ?? ""}:${activo.divisa}:${usados.get(activo.id)}`)
    .sort();
  return [cartera.id, cartera.divisaBase, primera?.slice(0, 4) ?? "", hasta, cartera.referencia?.activoId ?? "", [...divisas].sort().join(","), ...activos].join("|");
}

export function useMercadoDeCartera(cartera: Cartera, hasta: Dia): MercadoDeCartera {
  const demo = esDemostracion(cartera);
  const huella = huellaDeLoQueSePide(cartera, hasta);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ huella: string; mercado: MercadoCargado; error: string | null } | null>(null);

  /* La demostración trae su propio mercado, sintético: no pide nada a nadie. */
  const deLaDemo = useMemo<MercadoCargado | null>(() => {
    if (!demo) return null;
    const generada = demostracion(hasta);
    return { datos: generada.mercado, fichas: generada.fichas, referencia: generada.referencia, avisos: [] };
  }, [demo, hasta]);

  useEffect(() => {
    if (demo || !HAY_PLATAFORMA) return;
    let vigente = true;
    cargarMercado(cartera, hasta, fuenteDeLaPlataforma)
      .then((mercado) => {
        if (vigente) setResultado({ huella, mercado, error: null });
      })
      .catch((causa: unknown) => {
        if (vigente) setResultado({ huella, mercado: MERCADO_VACIO, error: `No se han podido leer los datos de mercado: ${motivoEnLlano(causa)}.` });
      });
    return () => {
      vigente = false;
    };
    /* La cartera entra por su huella: un movimiento nuevo de un activo que ya estaba, en un año que ya se pedía, no vuelve a pedir nada. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huella, intento, demo]);

  if (deLaDemo) return { mercado: deLaDemo, cargando: false, error: null, reintentar: () => undefined };
  if (!HAY_PLATAFORMA) {
    return {
      mercado: { ...MERCADO_VACIO, avisos: ["Esta instalación no tiene conexión con la plataforma de datos: las posiciones se valoran con precios a mano o con el de su última operación."] },
      cargando: false,
      error: null,
      reintentar: () => undefined
    };
  }
  const alDia = resultado !== null && resultado.huella === huella;
  return {
    /* Mientras llegan los datos nuevos se sigue enseñando lo anterior: la pantalla no parpadea. */
    mercado: resultado?.mercado ?? MERCADO_VACIO,
    cargando: !alDia,
    error: alDia ? resultado.error : null,
    reintentar: () => setIntento((n) => n + 1)
  };
}

export interface AnalisisDeCartera {
  preparado: Preparado;
  periodos: PeriodoHabitual[];
  periodo: Periodo;
  /** Si el periodo elegido no se podía dar y se enseña «desde el inicio» (GES-12). */
  caido: boolean;
  analisis: Analisis;
}

export interface PeriodoElegido {
  id: IdDePeriodo;
  /** Solo con `id: "libre"`. */
  libre?: Periodo;
}

/**
 * El periodo que se analiza para lo elegido. Si lo elegido no se puede dar (dos fechas que no forman
 * un periodo, o un periodo sin historia), cae a «desde el inicio» y lo dice con `caido`, para que la
 * pantalla no lo rotule con el nombre de lo elegido.
 */
export function periodoDelAnalisis(elegido: PeriodoElegido, periodos: readonly PeriodoHabitual[]): { periodo: Periodo; caido: boolean } {
  if (elegido.id === "libre" && elegido.libre && elegido.libre.desde < elegido.libre.hasta) return { periodo: elegido.libre, caido: false };
  const habitual = elegido.id === "libre" ? undefined : periodos.find((candidato) => candidato.id === elegido.id && candidato.disponible);
  if (habitual) return { periodo: habitual.periodo, caido: false };
  return { periodo: periodos.find((candidato) => candidato.id === "inicio")!.periodo, caido: elegido.id !== "inicio" };
}

/** El análisis de la cartera a una fecha y para el periodo elegido. Si el periodo elegido no tiene historia, cae a «desde el inicio». */
export function useAnalisisDeCartera(cartera: Cartera, mercado: MercadoCargado, hasta: Dia, elegido: PeriodoElegido): AnalisisDeCartera {
  const preparado = useMemo(() => preparar(cartera, mercado.datos, mercado.fichas, hasta), [cartera, mercado, hasta]);
  const periodos = useMemo(() => periodosHabituales(preparado.valoracion, hasta), [preparado, hasta]);
  const { periodo, caido } = useMemo(() => periodoDelAnalisis(elegido, periodos), [elegido, periodos]);
  const analisis = useMemo(() => analizarConLaReferencia(preparado, periodo, mercado.referencia), [preparado, periodo, mercado.referencia]);
  return { preparado, periodos, periodo, caido, analisis };
}

/**
 * El análisis de un periodo con su referencia. La serie de la referencia se construye aquí, con el
 * primer día del periodo: el de una cartera de referencia fija sus pesos ese día (decisión 39), y el
 * de la liquidez capitaliza el €STR desde él. `analizar` recibe una serie y no sabe de dónde sale.
 *
 * Si la referencia no se puede dar, el análisis lo dice con el motivo de aquí, no con uno genérico.
 */
export function analizarConLaReferencia(preparado: Preparado, periodo: Periodo, entrada: EntradaDeReferencia | undefined): Analisis {
  if (!entrada) return analizar(preparado, periodo);
  const tramo = tramoDe(preparado.valoracion, periodo);
  /* Sin tramo la cartera no tiene historia en el periodo, y `analizar` ya lo dice. */
  const lista = tramo ? serieDeLaReferencia(entrada, tramo.desde, tramo.hasta) : { nombre: entrada.nombre, serie: [] };
  if ("serie" in lista) return analizar(preparado, periodo, lista);
  const analisis = analizar(preparado, periodo);
  return {
    ...analisis,
    referencia: { nombre: lista.nombre, disponible: false, motivo: lista.motivo, serie: [], rentabilidad: null, rentabilidadAnualizada: null, diferencia: null }
  };
}
