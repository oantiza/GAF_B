/**
 * La comparación de carteras, sin React: cómo se analiza cada candidata con el MISMO motor y
 * en el MISMO periodo que la cartera abierta.
 *
 *  - Una cartera del gestor se abre de la carpeta, se le cargan sus precios y se analiza
 *    como cualquier otra: con sus movimientos reales.
 *  - Una cartera de Diseño son pesos. Se cruza con el catálogo, se cargan los precios de
 *    sus activos y se convierte en el libro más simple que la representa: el primer día del
 *    periodo se aporta un capital y se compra cada activo por su peso. Sin reequilibrar,
 *    sin aportaciones y sin comisiones (`motor/desdePesos.ts`). Por eso de ella se comparan
 *    la rentabilidad y el riesgo, no los euros.
 *
 * Todo lo que no se ha podido incluir se devuelve para decirlo en pantalla, nunca se tapa.
 */
import type { AlmacenDeCarteras } from "../../almacen/almacen";
import type { FuenteDeMercado } from "../../mercado/cargar";
import { cargarMercado, cargarMercadoDeActivos } from "../../mercado/cargar";
import { activoDesdeElCatalogo, type ActivoDeCatalogo } from "../../mercado/fichas";
import { analizar, preparar, type Analisis } from "../../motor/analisis";
import { carteraDesdePesos, type PosicionPorPeso } from "../../motor/desdePesos";
import type { Dia } from "../../motor/fechas";
import type { Periodo } from "../../motor/rentabilidad";
import { ultimoHasta } from "../../motor/valoracion";

/** Capital con el que se simula una cartera de pesos cuando la abierta no tenía nada al empezar. */
export const CAPITAL_POR_DEFECTO = 100_000;

/** Una posición de una cartera de Diseño: su ISIN y su peso en %, como los guarda Diseño. */
export interface PosicionDeDiseno {
  isin: string;
  pesoPorCien: number;
}

export type Candidata =
  | { clase: "gestor"; clave: string; nombre: string; fichero: string }
  | { clase: "diseno"; clave: string; nombre: string; posiciones: PosicionDeDiseno[] };

export interface CarteraComparada {
  clave: string;
  nombre: string;
  clase: Candidata["clase"];
  analisis: Analisis;
  /** ISIN de Diseño que el catálogo de la plataforma no tiene, con su peso en fracción. Su peso se queda en efectivo. */
  noEncontrados: Array<{ isin: string; peso: number }>;
  /** Activos de Diseño que no se pudieron comprar el primer día, con su motivo. */
  sinComprar: Array<{ nombre: string; peso: number; motivo: string }>;
  /** Parte del capital que sí se invirtió el primer día (solo en las de Diseño). */
  invertido?: number;
  /** Si la cartera empieza después que el periodo: se mide desde ese día. */
  empiezaEl?: Dia;
  /** Si no tiene historia en el periodo. */
  sinHistoria: boolean;
  /** Lo que no se pudo leer de la plataforma al cargar sus precios. */
  avisos: string[];
}

export interface ContextoDeComparacion {
  /** El periodo común: el de la cartera abierta. */
  periodo: Periodo;
  hoy: Dia;
  divisaBase: string;
  /** Con qué capital se simula una cartera de pesos. */
  capital: number;
  fuente: FuenteDeMercado;
  catalogo: () => Promise<ActivoDeCatalogo[]>;
  almacen: Pick<AlmacenDeCarteras, "abrir"> | null;
}

/** El capital de una simulación: lo que valía la abierta al empezar el periodo, o 100.000 si no valía nada. */
export function capitalDeReferencia(analisis: Analisis): number {
  const inicial = analisis.rentabilidad?.valorInicial ?? 0;
  return inicial > 0 ? inicial : CAPITAL_POR_DEFECTO;
}

function resultado(base: Omit<CarteraComparada, "sinHistoria" | "empiezaEl">, periodo: Periodo): CarteraComparada {
  const desde = base.analisis.rentabilidad?.desde;
  return { ...base, sinHistoria: !base.analisis.rentabilidad, empiezaEl: desde && desde > periodo.desde ? desde : undefined };
}

/** Una cartera del gestor guardada en la carpeta, analizada en el periodo común. */
export async function analizarCarteraDelGestor(candidata: Extract<Candidata, { clase: "gestor" }>, contexto: ContextoDeComparacion): Promise<CarteraComparada> {
  if (!contexto.almacen) throw new Error("No hay carpeta de carteras abierta.");
  const { cartera } = await contexto.almacen.abrir(candidata.fichero);
  const mercado = await cargarMercado(cartera, contexto.hoy, contexto.fuente);
  const analisis = analizar(preparar(cartera, mercado.datos, mercado.fichas, contexto.hoy), contexto.periodo);
  return resultado({ clave: candidata.clave, nombre: cartera.nombre || candidata.nombre, clase: "gestor", analisis, noEncontrados: [], sinComprar: [], avisos: mercado.avisos }, contexto.periodo);
}

/** Una cartera de Diseño, simulada comprando sus pesos el primer día del periodo común. */
export async function analizarCarteraDeDiseno(candidata: Extract<Candidata, { clase: "diseno" }>, contexto: ContextoDeComparacion): Promise<CarteraComparada> {
  const { periodo, hoy, divisaBase } = contexto;
  const catalogo = await contexto.catalogo();
  const porIsin = new Map(catalogo.map((activo) => [activo.isin, activo]));
  const noEncontrados: CarteraComparada["noEncontrados"] = [];
  const posiciones: PosicionPorPeso[] = [];
  for (const posicion of candidata.posiciones) {
    if (!(posicion.pesoPorCien > 0)) continue;
    const deCatalogo = porIsin.get(posicion.isin);
    /* Lo que el catálogo no tiene no se sustituye ni se reparte entre los demás: su peso se queda en efectivo. */
    if (!deCatalogo) noEncontrados.push({ isin: posicion.isin, peso: posicion.pesoPorCien / 100 });
    else posiciones.push({ activo: activoDesdeElCatalogo(deCatalogo), peso: posicion.pesoPorCien / 100 });
  }
  if (posiciones.length === 0) throw new Error("Ninguno de sus activos está en el catálogo de la plataforma: no se puede simular.");

  const mercado = await cargarMercadoDeActivos(posiciones.map((posicion) => posicion.activo), divisaBase, periodo.desde, hoy, contexto.fuente);
  const deLaCartera = carteraDesdePesos(posiciones, {
    id: `diseno-${candidata.clave}`,
    nombre: candidata.nombre,
    divisaBase,
    fecha: periodo.desde,
    capital: contexto.capital,
    precio: (activoId, fecha) => ultimoHasta(mercado.datos.precios.get(activoId), fecha)?.valor,
    cambio: (divisa, fecha) => ultimoHasta(mercado.datos.cambios.get(divisa), fecha)?.valor
  });
  if (deLaCartera.invertido <= 0) throw new Error(`Ninguno de sus activos tiene precio el ${periodo.desde}: no se puede simular.`);
  const analisis = analizar(preparar(deLaCartera.cartera, mercado.datos, mercado.fichas, hoy), periodo);
  return resultado(
    {
      clave: candidata.clave,
      nombre: candidata.nombre,
      clase: "diseno",
      analisis,
      noEncontrados,
      sinComprar: deLaCartera.sinComprar.map((linea) => ({ nombre: linea.activo.nombre, peso: linea.peso, motivo: linea.motivo })),
      invertido: deLaCartera.invertido,
      avisos: mercado.avisos
    },
    periodo
  );
}

export function analizarCandidata(candidata: Candidata, contexto: ContextoDeComparacion): Promise<CarteraComparada> {
  return candidata.clase === "gestor" ? analizarCarteraDelGestor(candidata, contexto) : analizarCarteraDeDiseno(candidata, contexto);
}

/** La clave de un cálculo: la misma candidata en otro periodo es otro cálculo. */
export function claveDelCalculo(candidata: Candidata, periodo: Periodo): string {
  return `${candidata.clave}|${periodo.desde}|${periodo.hasta}`;
}
