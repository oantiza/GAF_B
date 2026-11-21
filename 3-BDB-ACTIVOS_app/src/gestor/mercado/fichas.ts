/**
 * De la tarjeta de un instrumento de la plataforma a lo que el gestor necesita de él:
 * cómo se reparte (clase de activo, región, sector), sus gastos corrientes y sus datos de
 * identidad para darlo de alta en una cartera. Cálculo puro sobre el documento ya leído.
 */
import { CLASE_DE_ACTIVO, SECTOR_DEL_REPARTO, SECTOR_EN_INGLES } from "../../core/etiquetasDeReparto";
import { subzonaDeUnaAccion, zonaDeLaClave } from "../../core/regionTaxonomy";
import type { FichaDeActivo } from "../motor/composicion";
import type { Activo, TipoDeActivo } from "../motor/modelo";

type Documento = Record<string, unknown>;

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : undefined;
}

function numero(valor: unknown): number | undefined {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

const TIPO_POR_INSTRUMENTO: Record<string, TipoDeActivo> = { FUND: "FONDO", ETF: "ETF", STOCK: "ACCION" };

/** Un instrumento del catálogo, con lo justo para buscarlo y darlo de alta. */
export interface ActivoDeCatalogo {
  isin: string;
  nombre: string;
  tipo: TipoDeActivo;
  divisa: string;
  ticker?: string;
  /** Categoría del fondo o sector de la acción, para distinguir dos resultados parecidos. */
  detalle?: string;
}

export function activoDeCatalogo(tarjeta: Documento): ActivoDeCatalogo | undefined {
  const isin = texto(tarjeta.instrument_id);
  const identidad = objeto(tarjeta.identity);
  const nombre = texto(identidad?.name);
  if (!isin || !nombre) return undefined;
  const clasificacion = objeto(tarjeta.classification);
  const sector = texto(clasificacion?.sector);
  return {
    isin,
    nombre,
    tipo: TIPO_POR_INSTRUMENTO[texto(tarjeta.instrument_type) ?? ""] ?? "OTRO",
    divisa: texto(identidad?.currency) ?? "EUR",
    ticker: texto(identidad?.ticker),
    detalle: texto(clasificacion?.category) ?? (sector ? SECTOR_EN_INGLES[sector] ?? sector : undefined)
  };
}

/** El activo de cartera que corresponde a un instrumento del catálogo. Su `id` es el ISIN. */
export function activoDesdeElCatalogo(deCatalogo: ActivoDeCatalogo): Activo {
  return {
    id: deCatalogo.isin,
    isin: deCatalogo.isin,
    nombre: deCatalogo.nombre,
    tipo: deCatalogo.tipo,
    divisa: deCatalogo.divisa,
    ticker: deCatalogo.ticker,
    origen: "catalogo"
  };
}

/** Normaliza un reparto: solo pesos positivos, con el nombre que da `nombrar`, sumando los que comparten nombre. */
function repartoCon(origen: Record<string, unknown> | undefined, nombrar: (clave: string) => string | undefined): Record<string, number> | undefined {
  if (!origen) return undefined;
  const reparto: Record<string, number> = {};
  let total = 0;
  for (const [clave, valor] of Object.entries(origen)) {
    const peso = numero(valor);
    const nombre = nombrar(clave);
    if (peso === undefined || peso <= 0 || !nombre) continue;
    reparto[nombre] = (reparto[nombre] ?? 0) + peso;
    total += peso;
  }
  if (total <= 0) return undefined;
  /* Un reparto que pasa de 1 por redondeos del proveedor se reescala; uno que se queda corto se deja: lo que falta es «sin clasificar». */
  if (total > 1) for (const nombre of Object.keys(reparto)) reparto[nombre] /= total;
  return reparto;
}

/** La ficha de reparto de un instrumento, a partir de su tarjeta. */
export function fichaDeLaTarjeta(tarjeta: Documento): FichaDeActivo {
  const exposicion = objeto(tarjeta.exposure);
  const clasificacion = objeto(tarjeta.classification);
  const costes = objeto(tarjeta.costs);
  const isin = texto(tarjeta.instrument_id);
  const esAccion = texto(tarjeta.instrument_type) === "STOCK";
  const mezcla = objeto(exposicion?.asset_mix);

  const clases = repartoCon(mezcla, (clave) => CLASE_DE_ACTIVO[clave]);
  let regiones = repartoCon(objeto(exposicion?.equity_regions), (clave) => zonaDeLaClave(clave));
  let sectores = repartoCon(objeto(exposicion?.sectors), (clave) => SECTOR_DEL_REPARTO[clave]);

  if (esAccion) {
    /* Una acción no trae repartos: su región es la del país de su ISIN y su sector, el que declara. */
    const subzona = subzonaDeUnaAccion(isin);
    const zona = subzona ? zonaDeLaClave(subzona) : undefined;
    if (!regiones && zona) regiones = { [zona]: 1 };
    const sector = texto(clasificacion?.sector);
    if (!sectores && sector) sectores = { [SECTOR_EN_INGLES[sector] ?? sector]: 1 };
  }

  return {
    clases: clases ?? (esAccion ? { "Renta variable": 1 } : undefined),
    regiones,
    sectores,
    gastosCorrientes: numero(costes?.ongoing_charge),
    rentaVariable: numero(mezcla?.equity) ?? (esAccion ? 1 : undefined)
  };
}
