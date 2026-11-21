/**
 * El registro de secciones de los tres informes: el del cliente, el de costes (los dos con el tema
 * de cliente de la plantilla) y el del asesor (con el tema interno).
 *
 * AÑADIR UNA SECCIÓN: crea su módulo en `secciones/cliente/`, `secciones/costes/` o `secciones/asesor/` (un `id`
 * único, su título, cuándo `procede` con los datos y su `Contenido`, escrito con las piezas de la plantilla) y
 * añádela a la lista, en el sitio en que debe imprimirse. Nada más: la plantilla (`HojasDeSecciones`) numera el
 * título, reparte las hojas y se salta las secciones que no proceden, sin dejar ni su título ni una hoja vacía. Una
 * sección no calcula: imprime el `Analisis`. Si le falta una cifra, se añade en el motor.
 *
 * `tests/gestor/informesRegistro.test.ts` comprueba que los `id` no se repiten, que todas
 * tienen título y que quitar una no rompe las demás.
 */
import { avisos } from "./secciones/asesor/avisos";
import { bonos } from "./secciones/asesor/bonos";
import { cerradas } from "./secciones/asesor/cerradas";
import { composicion as composicionDelAsesor } from "./secciones/asesor/composicion";
import { conciliacion } from "./secciones/asesor/conciliacion";
import { ingresosYCostes } from "./secciones/asesor/ingresosYCostes";
import { movimientos as movimientosDelAsesor } from "./secciones/asesor/movimientos";
import { posiciones } from "./secciones/asesor/posiciones";
import { rentabilidad } from "./secciones/asesor/rentabilidad";
import { resumen } from "./secciones/asesor/resumen";
import { sinDatos as sinDatosDelAsesor } from "./secciones/asesor/sinDatos";
import { composicion as composicionDelCliente, distribucion } from "./secciones/cliente/composicion";
import { movimientos as movimientosDelCliente } from "./secciones/cliente/movimientos";
import { notas } from "./secciones/cliente/notas";
import { presentacion } from "./secciones/cliente/presentacion";
import { referencia } from "./secciones/cliente/referencia";
import { resultado } from "./secciones/cliente/resultado";
import { riesgo } from "./secciones/cliente/riesgo";
import { sinDatos as sinDatosDelCliente } from "./secciones/cliente/sinDatos";
import { vistazo } from "./secciones/cliente/vistazo";
import { impuestos } from "./secciones/costes/impuestos";
import { metodo } from "./secciones/costes/metodo";
import { operaciones } from "./secciones/costes/operaciones";
import { presentacion as presentacionDeCostes } from "./secciones/costes/presentacion";
import { productos } from "./secciones/costes/productos";
import { resumen as resumenDeCostes } from "./secciones/costes/resumen";
import { servicio } from "./secciones/costes/servicio";
import type { SeccionDeInforme, TipoDeInforme } from "./tipos";

/**
 * El informe que se entrega o se enseña al cliente, con el tema de cliente. Los costes no van aquí: tienen su informe.
 *
 * El orden, de Óscar (16-11-2026): la portada solo con el nombre; la cartera (lo que tiene y dónde está invertida); y, en hoja
 * aparte, las cifras: cómo ha ido, su riesgo, de dónde viene el resultado y frente a su referencia; detrás, los movimientos y las notas.
 */
export const SECCIONES_DEL_CLIENTE: readonly SeccionDeInforme[] = [
  presentacion,
  sinDatosDelCliente,
  composicionDelCliente,
  distribucion,
  vistazo,
  riesgo,
  resultado,
  referencia,
  movimientosDelCliente,
  notas
];

/** El informe de costes, también con el tema de cliente: al estilo de la información de costes ex post de MiFID II. */
export const SECCIONES_DE_COSTES: readonly SeccionDeInforme[] = [
  presentacionDeCostes,
  sinDatosDelCliente,
  resumenDeCostes,
  servicio,
  operaciones,
  productos,
  impuestos,
  metodo
];

/** La herramienta de trabajo del asesor, con el tema interno. */
export const SECCIONES_DEL_ASESOR: readonly SeccionDeInforme[] = [
  resumen,
  sinDatosDelAsesor,
  avisos,
  /* La conciliación va con los avisos, antes de las cifras: es lo que el asesor comprueba antes de fiarse de ellas. Al final, además,
     se quedaba sola en una hoja casi vacía antes de los movimientos, que van en hoja apaisada. */
  conciliacion,
  posiciones,
  /* Los bonos son el detalle de unas posiciones: van detrás de ellas, en la misma hoja apaisada, que tenía sitio. Al final se quedaban
     solos en una hoja antes de los movimientos. */
  bonos,
  rentabilidad,
  ingresosYCostes,
  cerradas,
  composicionDelAsesor,
  movimientosDelAsesor
];

const POR_TIPO: Record<TipoDeInforme, readonly SeccionDeInforme[]> = {
  cliente: SECCIONES_DEL_CLIENTE,
  asesor: SECCIONES_DEL_ASESOR,
  costes: SECCIONES_DE_COSTES
};

export function seccionesDe(tipo: TipoDeInforme): readonly SeccionDeInforme[] {
  return POR_TIPO[tipo];
}

for (const [nombre, lista] of Object.entries(POR_TIPO)) {
  if (new Set(lista.map((seccion) => seccion.id)).size !== lista.length) throw new Error(`Hay dos secciones del informe «${nombre}» con el mismo identificador.`);
}
