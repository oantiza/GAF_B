/**
 * Cableado a la callable `generate_portfolio_draft` (`functions_python/generador_de_carteras.py`, decisión 122 de Óscar).
 *
 * El borrador se calcula en el servidor porque la consistencia necesita la serie de todos los fondos de cada bloque, unos 117, y
 * la ficha de un fondo no la lleva. Solo lectura. Los errores se propagan para decirlos en pantalla: con la base vieja, el
 * servidor contesta que el generador necesita la base nueva.
 */
import { callBackend } from "./callableBackend";
import {
  requireArray, requireBoolean, requireNumber, requireObject, requireOneOf, requireOptionalNumber, requireOptionalString,
  requireString, requireStringArray
} from "./contractGuards";

export const GENERADOR_TIMEOUT_MS = 120_000;

/**
 * Lo que significa cada nivel: el porcentaje de renta variable. Es la tabla del servidor (`RENTA_VARIABLE_POR_NIVEL`), y
 * `tests/generadorDeCarteras.test.tsx` falla si las dos se separan: la pantalla lo dice antes de generar.
 */
export const RENTA_VARIABLE_POR_NIVEL: Readonly<Record<number, number>> = { 1: 0, 2: 10, 3: 20, 4: 30, 5: 40, 6: 50, 7: 60, 8: 70, 9: 85, 10: 100 };

export const FONDOS_POR_DEFECTO = 8;
export const FONDOS_MAXIMOS = 30;

export interface PedidoDeBorrador {
  nivel: number;
  num_fondos: number;
  incluir_indexados: boolean;
}

export interface PilaresDelFondo {
  calidad: number;
  solidez: number;
  consistencia: number;
  coste: number;
}

export interface PosicionDelBorrador {
  asset_id: string;
  nombre: string;
  bloque: string;
  /** Peso en la cartera, en %. Los del borrador suman 100. */
  peso_pct: number;
  /** De 0 a 1: su posición en su bloque, ponderada por pilares. */
  nota: number;
  pilares: PilaresDelFondo;
  /** Gasto corriente del KID, en %. */
  gasto_corriente_pct: number;
  patrimonio: number;
  patrimonio_divisa?: string;
  /** Años desde el lanzamiento de la clase. */
  anios: number;
  indexado: boolean;
  candidatos_del_bloque: number;
}

export interface BorradorDeCartera {
  estado: "OK" | "FALTAN_FONDOS";
  metodo: string;
  nivel: number;
  nombre_del_nivel: string;
  renta_variable_pct: number;
  num_fondos_pedidos: number;
  minimo_de_fondos: number;
  maximo_de_fondos: number;
  incluir_indexados: boolean;
  ventana: { desde: string; hasta: string };
  posiciones: PosicionDelBorrador[];
  avisos: string[];
  /** Solo con `FALTAN_FONDOS`: cuántos hacen falta, dicho entero. */
  aviso?: string;
  gasto_corriente_medio_pct?: number;
  candidatos_por_bloque: Record<string, number>;
}

function parsePosicion(raw: unknown, campo: string): PosicionDelBorrador {
  const p = requireObject(raw, campo);
  const pilares = requireObject(p.pilares, `${campo}.pilares`);
  return {
    asset_id: requireString(p.asset_id, `${campo}.asset_id`),
    nombre: requireString(p.nombre, `${campo}.nombre`),
    bloque: requireString(p.bloque, `${campo}.bloque`),
    peso_pct: requireNumber(p.peso_pct, `${campo}.peso_pct`),
    nota: requireNumber(p.nota, `${campo}.nota`),
    pilares: {
      calidad: requireNumber(pilares.calidad, `${campo}.pilares.calidad`),
      solidez: requireNumber(pilares.solidez, `${campo}.pilares.solidez`),
      consistencia: requireNumber(pilares.consistencia, `${campo}.pilares.consistencia`),
      coste: requireNumber(pilares.coste, `${campo}.pilares.coste`)
    },
    gasto_corriente_pct: requireNumber(p.gasto_corriente_pct, `${campo}.gasto_corriente_pct`),
    patrimonio: requireNumber(p.patrimonio, `${campo}.patrimonio`),
    patrimonio_divisa: requireOptionalString(p.patrimonio_divisa ?? undefined, `${campo}.patrimonio_divisa`),
    anios: requireNumber(p.anios, `${campo}.anios`),
    indexado: requireBoolean(p.indexado, `${campo}.indexado`),
    candidatos_del_bloque: requireNumber(p.candidatos_del_bloque, `${campo}.candidatos_del_bloque`)
  };
}

export function parseBorrador(raw: unknown): BorradorDeCartera {
  const data = requireObject(raw, "borrador");
  const ventana = requireObject(data.ventana, "ventana");
  const candidatos = requireObject(data.candidatos_por_bloque ?? {}, "candidatos_por_bloque");
  return {
    estado: requireOneOf(data.estado, ["OK", "FALTAN_FONDOS"] as const, "estado"),
    metodo: requireString(data.metodo, "metodo"),
    nivel: requireNumber(data.nivel, "nivel"),
    nombre_del_nivel: requireString(data.nombre_del_nivel, "nombre_del_nivel"),
    renta_variable_pct: requireNumber(data.renta_variable_pct, "renta_variable_pct"),
    num_fondos_pedidos: requireNumber(data.num_fondos_pedidos, "num_fondos_pedidos"),
    minimo_de_fondos: requireNumber(data.minimo_de_fondos, "minimo_de_fondos"),
    maximo_de_fondos: requireNumber(data.maximo_de_fondos, "maximo_de_fondos"),
    incluir_indexados: requireBoolean(data.incluir_indexados, "incluir_indexados"),
    ventana: { desde: requireString(ventana.desde, "ventana.desde"), hasta: requireString(ventana.hasta, "ventana.hasta") },
    posiciones: requireArray(data.posiciones ?? [], "posiciones").map((p, i) => parsePosicion(p, `posiciones[${i}]`)),
    avisos: data.avisos ? requireStringArray(data.avisos, "avisos") : [],
    aviso: requireOptionalString(data.aviso ?? undefined, "aviso"),
    gasto_corriente_medio_pct: requireOptionalNumber(data.gasto_corriente_medio_pct ?? undefined, "gasto_corriente_medio_pct"),
    candidatos_por_bloque: Object.fromEntries(Object.entries(candidatos).map(([bloque, n]) => [bloque, requireNumber(n, `candidatos_por_bloque.${bloque}`)]))
  };
}

export async function fetchBorradorDeCartera(pedido: PedidoDeBorrador): Promise<BorradorDeCartera> {
  /* La misma espera que el servidor (`timeout_sec=120` de `generate_portfolio_draft` en main.py); sin ella, 70 s. */
  const raw = await callBackend<unknown>("generate_portfolio_draft", pedido, "No se pudo generar el borrador.", { timeout: GENERADOR_TIMEOUT_MS });
  return parseBorrador(raw);
}
