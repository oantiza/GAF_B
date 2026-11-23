/**
 * Integridad de los datos de una cartera: lo que el asesor tiene que mirar antes de fiarse
 * de una cifra. Nada de aquí cambia la cartera; solo señala.
 *
 *  - Movimientos que el libro no pudo aplicar.
 *  - Movimientos posiblemente duplicados.
 *  - Saldo de efectivo en negativo.
 *  - Precios que faltan, precios viejos y precios puestos a mano.
 *  - Conciliación con cada extracto importado: títulos por activo y saldo de efectivo.
 *  - Precios de operación muy alejados del de mercado de ese día.
 *
 * Los mensajes se escriben ya en español («13/11/2026», «−1.250,40 EUR», «12,5 títulos»): se
 * pintan tal cual en la pantalla y en el informe del asesor.
 */
import { aTexto, CERO, cifraEnTexto, d, importeEnTexto, type Decimal } from "./decimal";
import { diasEntre, fechaEnTexto, type Dia } from "./fechas";
import { construirLibro, extractoDeEfectivo, titulosDe, type Libro } from "./libro";
import type { Cartera, ExtractoDeclarado, Movimiento, PosicionDeclarada } from "./modelo";
import { nombreDelTipo } from "./movimientos/registro";
import { FUENTE, ultimoHasta, type DatosDeMercado, type SerieDeActivo, type Valoracion } from "./valoracion";

export type GravedadDelAviso = "error" | "aviso" | "nota";

export type CodigoDeIntegridad =
  | "MOVIMIENTO_SIN_APLICAR"
  | "DESCUBIERTO_DE_TITULOS"
  | "FALTA_EL_CAMBIO"
  | "POSIBLE_DUPLICADO"
  | "EFECTIVO_EN_NEGATIVO"
  | "SIN_PRECIO"
  | "PRECIO_ANTIGUO"
  | "PRECIO_A_MANO"
  | "PRECIO_DEL_EXTRACTO"
  | "PRECIO_DE_OPERACION"
  | "NO_CUADRA_CON_EL_EXTRACTO"
  | "DIVIDENDOS_SIN_REGISTRAR"
  | "PRECIO_ALEJADO_DEL_MERCADO"
  | "APUNTE_SIN_CLASIFICAR"
  | "CAMBIO_ANTIGUO"
  | "CAPITAL_RESIDUAL"
  | "SIN_CAPITAL"
  | "SIN_VALORAR"
  | "DIVIDENDO_SIN_FECHA_EX"
  | "CONCENTRACION";

export interface AvisoDeIntegridad {
  gravedad: GravedadDelAviso;
  codigo: CodigoDeIntegridad;
  /** Frase completa, en lenguaje llano, que dice qué pasa y, si se puede, qué hacer. */
  mensaje: string;
  activoId?: string;
  movimientoIds?: string[];
  fecha?: Dia;
}

/** Días a partir de los cuales un precio de mercado se considera viejo (cubre un puente largo). */
export const DIAS_DE_PRECIO_ANTIGUO = 7;
/** Peso a partir del cual se avisa de una posición concentrada. */
export const PESO_DE_CONCENTRACION = 0.25;
/** Distancia al precio de mercado del día a partir de la cual se avisa del precio de una operación (el mismo umbral que el formulario). */
export const DESVIO_DE_PRECIO_DE_OPERACION = 0.2;
/**
 * Peso de un «Otro cargo o abono» sobre el capital de su día a partir del cual se avisa (auditoría 16-11-2026, GES-3). Ese
 * tipo cuenta como resultado: un abono de 1.000 € en una cartera de 1.000 € es un +100 % ese día. Si era dinero del cliente,
 * la rentabilidad es falsa, y nada lo decía después de importarlo. Medio punto de la rentabilidad del día: por debajo (una
 * retrocesión de unos euros, un redondeo) no se avisa.
 */
export const PESO_DE_UN_APUNTE_SIN_CLASIFICAR = 0.005;
/**
 * Cuántos días antes del cobro de un dividendo se mira si la posición cambió (auditoría 16-11-2026, GES-8). Entre la fecha
 * ex y el cobro pasan dos o tres días en un valor español y unas semanas en uno americano; un mes los cubre casi todos.
 */
export const DIAS_ANTES_DEL_COBRO_DE_UN_DIVIDENDO = 30;

function clave(movimiento: Movimiento): string {
  return [
    movimiento.tipo,
    movimiento.fechaOperacion,
    movimiento.activoId ?? "",
    movimiento.importe ? d(movimiento.importe).toFixed(2) : "",
    movimiento.titulos ? d(movimiento.titulos).toFixed(6) : "",
    movimiento.divisa ?? "",
    movimiento.destino?.activoId ?? ""
  ].join("|");
}

/** Grupos de movimientos que coinciden en tipo, fecha, activo, importe y títulos: candidatos a duplicado. */
export function posiblesDuplicados(movimientos: readonly Movimiento[]): Movimiento[][] {
  const grupos = new Map<string, Movimiento[]>();
  for (const movimiento of movimientos) {
    const lista = grupos.get(clave(movimiento)) ?? [];
    lista.push(movimiento);
    grupos.set(clave(movimiento), lista);
  }
  return [...grupos.values()].filter((grupo) => grupo.length > 1);
}

/** Los movimientos de `nuevos` que ya están en `existentes` (misma clave). Para avisar al importar dos veces. */
export function yaEnElLibro(nuevos: readonly Movimiento[], existentes: readonly Movimiento[]): Set<string> {
  const disponibles = new Map<string, number>();
  for (const movimiento of existentes) disponibles.set(clave(movimiento), (disponibles.get(clave(movimiento)) ?? 0) + 1);
  const repetidos = new Set<string>();
  for (const movimiento of nuevos) {
    const quedan = disponibles.get(clave(movimiento)) ?? 0;
    if (quedan > 0) {
      repetidos.add(movimiento.id);
      disponibles.set(clave(movimiento), quedan - 1);
    }
  }
  return repetidos;
}

export interface DiferenciaDeConciliacion {
  clase: "titulos" | "efectivo";
  /** Nombre del activo o divisa del efectivo. */
  concepto: string;
  activoId?: string;
  enElLibro: Decimal;
  enElExtracto: Decimal;
  diferencia: Decimal;
}

export interface Conciliacion {
  extracto: ExtractoDeclarado;
  cuadra: boolean;
  /** Líneas comprobadas: posiciones más saldos de efectivo. */
  comprobadas: number;
  diferencias: DiferenciaDeConciliacion[];
}

/** Tolerancias: una milésima de título (redondeos de participaciones) y un céntimo de efectivo. */
const TOLERANCIA_DE_TITULOS = d("0.001");
const TOLERANCIA_DE_EFECTIVO = d("0.01");

/**
 * Las posiciones de un extracto, UNA POR ACTIVO (auditoría 16-11-2026, GES-6). Un banco puede declarar el mismo valor en
 * varias filas (dos depósitos, dos cuentas de valores): se suman sus títulos y su valor. Antes cada fila se comparaba por
 * separado con el total del libro: 15 títulos declarados en dos filas de 10 y 5 daban dos diferencias falsas y la cartera
 * no podía cuadrar nunca; y al proponer las posiciones iniciales entraba solo la primera fila. El valor de la suma falta si
 * falta el de alguna fila. Lo que no se resuelve a un activo de la cartera se agrupa por su ISIN o, sin él, por su nombre.
 */
export function posicionesPorActivo(cartera: Cartera, extracto: ExtractoDeclarado): PosicionDeclarada[] {
  const porIsin = new Map(cartera.activos.filter((activo) => activo.isin).map((activo) => [activo.isin!, activo]));
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  const grupos = new Map<string, PosicionDeclarada>();
  for (const declarada of extracto.posiciones) {
    const activo = (declarada.activoId ? porId.get(declarada.activoId) : undefined) ?? (declarada.isin ? porIsin.get(declarada.isin) : undefined);
    const clave = activo ? `activo:${activo.id}` : declarada.isin ? `isin:${declarada.isin}` : `nombre:${declarada.nombre}`;
    const previa = grupos.get(clave);
    if (!previa) {
      grupos.set(clave, { ...declarada });
      continue;
    }
    previa.titulos = aTexto(d(previa.titulos).plus(d(declarada.titulos)));
    if (previa.valor !== undefined && declarada.valor !== undefined) previa.valor = aTexto(d(previa.valor).plus(d(declarada.valor)));
    else delete previa.valor;
    /* El precio no se suma: es el mismo en las dos filas, y si no lo es (o una no lo dice), la suma no tiene precio (A-205). */
    const mismoPrecio = previa.precio !== undefined && declarada.precio !== undefined && previa.divisa === declarada.divisa && d(previa.precio).eq(d(declarada.precio));
    if (!mismoPrecio) {
      delete previa.precio;
      delete previa.divisa;
    }
  }
  return [...grupos.values()];
}

/** Compara el libro, a la fecha del extracto, con lo que el extracto declara. */
export function conciliar(cartera: Cartera, extracto: ExtractoDeclarado): Conciliacion {
  const libro = construirLibro(cartera, { hasta: extracto.fecha });
  const diferencias: DiferenciaDeConciliacion[] = [];
  const porIsin = new Map(cartera.activos.filter((activo) => activo.isin).map((activo) => [activo.isin!, activo]));
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  const vistos = new Set<string>();
  const declaradas = posicionesPorActivo(cartera, extracto);

  for (const declarada of declaradas) {
    const activo = (declarada.activoId ? porId.get(declarada.activoId) : undefined) ?? (declarada.isin ? porIsin.get(declarada.isin) : undefined);
    const enElExtracto = d(declarada.titulos);
    const enElLibro = activo ? titulosDe(libro.final, activo.id) : CERO;
    if (activo) vistos.add(activo.id);
    const diferencia = enElLibro.minus(enElExtracto);
    if (diferencia.abs().gt(TOLERANCIA_DE_TITULOS)) {
      diferencias.push({ clase: "titulos", concepto: activo?.nombre ?? declarada.nombre, activoId: activo?.id, enElLibro, enElExtracto, diferencia });
    }
  }
  /* Lo que el libro tiene y el extracto no menciona: solo si el extracto trae posiciones (uno de solo efectivo no dice nada de los valores). */
  if (extracto.posiciones.length > 0) {
    for (const [activoId] of libro.final.lotes) {
      if (vistos.has(activoId)) continue;
      const enElLibro = titulosDe(libro.final, activoId);
      if (enElLibro.abs().gt(TOLERANCIA_DE_TITULOS)) {
        diferencias.push({ clase: "titulos", concepto: porId.get(activoId)?.nombre ?? activoId, activoId, enElLibro, enElExtracto: CERO, diferencia: enElLibro });
      }
    }
  }
  for (const declarado of extracto.efectivo) {
    const enElExtracto = d(declarado.saldo);
    const enElLibro = libro.final.efectivo.get(declarado.divisa) ?? CERO;
    const diferencia = enElLibro.minus(enElExtracto);
    if (diferencia.abs().gt(TOLERANCIA_DE_EFECTIVO)) {
      diferencias.push({ clase: "efectivo", concepto: `Efectivo en ${declarado.divisa}`, enElLibro, enElExtracto, diferencia });
    }
  }
  return { extracto, cuadra: diferencias.length === 0, comprobadas: declaradas.length + extracto.efectivo.length, diferencias };
}

/** El primer día y el peor saldo de cada tramo en que la cuenta de efectivo de una divisa está en negativo. */
function efectivoEnNegativo(libro: Libro): Array<{ divisa: string; desde: Dia; minimo: Decimal }> {
  const tramos: Array<{ divisa: string; desde: Dia; minimo: Decimal }> = [];
  const divisas = new Set<string>();
  for (const apunte of libro.apuntes) if (apunte.efecto.clase === "efectivo" && !apunte.efecto.transito) divisas.add(apunte.efecto.divisa);
  for (const divisa of divisas) {
    /* Solo cuenta el saldo al cierre de cada día: dentro del día el orden de los apuntes no significa nada. */
    const alCierre = new Map<Dia, Decimal>();
    for (const linea of extractoDeEfectivo(libro, divisa)) alCierre.set(linea.fecha, linea.saldo);
    let abierto: { divisa: string; desde: Dia; minimo: Decimal } | undefined;
    for (const [fecha, saldo] of alCierre) {
      if (saldo.lt(d("-0.005"))) {
        if (!abierto) {
          abierto = { divisa, desde: fecha, minimo: saldo };
          tramos.push(abierto);
        } else if (saldo.lt(abierto.minimo)) abierto.minimo = saldo;
      } else abierto = undefined;
    }
  }
  return tramos;
}

/**
 * Operaciones cuyo precio se aleja mucho del de mercado de ese día: casi siempre un error de tecleo
 * (DIR-03). Solo donde la plataforma tiene serie y un dato de esa semana; el precio de la serie se
 * devuelve a títulos de ese día con los splits posteriores que ya ajusta. Una serie ajustada por
 * dividendos sale más baja en el pasado, así que en ella solo se avisa de un precio escrito POR DEBAJO:
 * el que queda por encima ya lo mira la valoración («puede faltar algún dividendo»). Una entrada de
 * títulos trae su coste de origen, que puede estar lejos del día sin ser un error.
 */
function preciosAlejados(cartera: Cartera, valoracion: Valoracion, mercado: DatosDeMercado, nombre: (activoId: string | undefined) => string): AvisoDeIntegridad[] {
  const avisos: AvisoDeIntegridad[] = [];
  for (const movimiento of cartera.movimientos) {
    if (!movimiento.activoId || !movimiento.precio || movimiento.tipo === "entradaDeTitulos") continue;
    const escrito = Number(movimiento.precio);
    const punto = ultimoHasta(mercado.precios.get(movimiento.activoId), movimiento.fechaOperacion);
    if (!(escrito > 0) || !punto || !(punto.valor > 0) || diasEntre(punto.fecha, movimiento.fechaOperacion) > DIAS_DE_PRECIO_ANTIGUO) continue;
    const splits = (valoracion.libro.ajustes.get(movimiento.activoId) ?? []).filter((ajuste) => ajuste.serieAjustada && ajuste.fecha > movimiento.fechaOperacion);
    const delMercado = splits.reduce((precio, ajuste) => precio * Number(ajuste.factor), punto.valor);
    const desvio = escrito / delMercado - 1;
    const ajustada = mercado.ajustadasPorDividendos?.has(movimiento.activoId) ?? false;
    if (Math.abs(desvio) <= DESVIO_DE_PRECIO_DE_OPERACION || (ajustada && desvio > 0)) continue;
    const divisa = cartera.activos.find((activo) => activo.id === movimiento.activoId)?.divisa ?? cartera.divisaBase;
    avisos.push({
      gravedad: "aviso",
      codigo: "PRECIO_ALEJADO_DEL_MERCADO",
      activoId: movimiento.activoId,
      movimientoIds: [movimiento.id],
      fecha: movimiento.fechaOperacion,
      mensaje: `${nombreDelTipo(movimiento.tipo)} de ${nombre(movimiento.activoId)} del ${fechaEnTexto(movimiento.fechaOperacion)} a ${cifraEnTexto(d(movimiento.precio))} ${divisa}: se aleja un ${cifraEnTexto(Math.abs(desvio) * 100, 0)} % del precio de mercado ${punto.fecha === movimiento.fechaOperacion ? "de ese día" : `del ${fechaEnTexto(punto.fecha)}`} (${cifraEnTexto(delMercado, 2)} ${divisa}). Si es un error de tecleo, corrige el movimiento.`
    });
  }
  return avisos;
}

export interface Integridad {
  avisos: AvisoDeIntegridad[];
  conciliaciones: Conciliacion[];
  /** Cuántos avisos hay de cada gravedad. */
  errores: number;
  advertencias: number;
}

/**
 * Los dividendos de una serie ajustada cobrados sin fecha ex cuando la posición cambió poco antes. El dividendo por título
 * sale entonces de los títulos del día del cobro, y si el cambio fue después de la fecha ex sale mal, y con él los precios
 * anteriores. No se sabe si fue así: se dice para que el asesor escriba la fecha ex si procede. Una posición recién abierta
 * no avisa: si se compró entera antes de la fecha ex, los títulos del cobro son los que tenían derecho.
 */
function dividendosConLaPosicionCambiada(libro: Libro, ajustadas: ReadonlySet<string>, nombre: (activoId: string | undefined) => string, hasta: Dia): AvisoDeIntegridad[] {
  const avisos: AvisoDeIntegridad[] = [];
  const titulos = new Map<string, number>();
  /* El último cambio de una posición que ya existía, por activo. */
  const ultimoCambio = new Map<string, Dia>();
  const mueve = (activoId: string, cuantos: number, fecha: Dia): void => {
    const antes = titulos.get(activoId) ?? 0;
    if (antes > 1e-9) ultimoCambio.set(activoId, fecha);
    titulos.set(activoId, Math.max(0, antes + cuantos));
  };
  for (const apunte of libro.apuntes) {
    if (apunte.fecha > hasta) break;
    const efecto = apunte.efecto;
    if (efecto.clase === "alta") mueve(efecto.activoId, Number(efecto.titulos), apunte.fecha);
    else if (efecto.clase === "baja") mueve(efecto.activoId, -Number(efecto.titulos), apunte.fecha);
    else if (efecto.clase === "canje") {
      mueve(efecto.activoId, efecto.titulos ? -Number(efecto.titulos) : -(titulos.get(efecto.activoId) ?? 0), apunte.fecha);
      mueve(efecto.destinoId, Number(efecto.titulosDestino), apunte.fecha);
    } else if (efecto.clase === "ingreso" && efecto.categoria === "dividendo" && efecto.activoId && ajustadas.has(efecto.activoId) && apunte.movimiento.fechaEx === undefined) {
      const cambio = ultimoCambio.get(efecto.activoId);
      if (cambio === undefined) continue;
      const dias = diasEntre(cambio, apunte.fecha);
      if (dias < 0 || dias > DIAS_ANTES_DEL_COBRO_DE_UN_DIVIDENDO) continue;
      avisos.push({
        gravedad: "nota",
        codigo: "DIVIDENDO_SIN_FECHA_EX",
        activoId: efecto.activoId,
        movimientoIds: [apunte.movimiento.id],
        fecha: apunte.fecha,
        mensaje: `${nombre(efecto.activoId)} cobró un dividendo el ${fechaEnTexto(apunte.fecha)} y su posición había cambiado el ${fechaEnTexto(cambio)}. Si ese cambio fue después de la fecha ex-dividendo, escríbela en el dividendo: sin ella se reparte entre los títulos del día del cobro, y los precios anteriores salen movidos.`
      });
    }
  }
  return avisos;
}

/** Todas las comprobaciones de una cartera, con su valoración ya hecha, a una fecha. Con `mercado`, también los precios de operación alejados del de mercado. */
export function comprobarIntegridad(cartera: Cartera, valoracion: Valoracion, fecha: Dia, mercado?: DatosDeMercado): Integridad {
  const avisos: AvisoDeIntegridad[] = [];
  const nombre = (activoId: string | undefined): string => cartera.activos.find((activo) => activo.id === activoId)?.nombre ?? activoId ?? "";

  for (const aviso of valoracion.libro.avisos) {
    avisos.push({
      gravedad: "error",
      codigo: aviso.codigo === "DESCUBIERTO_DE_TITULOS" ? "DESCUBIERTO_DE_TITULOS" : aviso.codigo === "FALTA_EL_CAMBIO" ? "FALTA_EL_CAMBIO" : "MOVIMIENTO_SIN_APLICAR",
      mensaje: aviso.mensaje,
      movimientoIds: [aviso.movimientoId],
      fecha: aviso.fecha
    });
  }
  for (const aviso of valoracion.avisos) {
    if (aviso.codigo === "SIN_CAMBIO") avisos.push({ gravedad: "error", codigo: "FALTA_EL_CAMBIO", mensaje: aviso.mensaje, fecha: aviso.desde });
    if (aviso.codigo === "DIVIDENDOS_SIN_REGISTRAR") avisos.push({ gravedad: "aviso", codigo: "DIVIDENDOS_SIN_REGISTRAR", mensaje: aviso.mensaje, activoId: aviso.activoId, fecha: aviso.desde });
    /* GES-2: días que no se encadenan porque la cartera estaba casi vacía. Solo si ya han pasado a la fecha pedida. */
    if (aviso.codigo === "CAPITAL_RESIDUAL" && aviso.desde <= fecha) avisos.push({ gravedad: "aviso", codigo: "CAPITAL_RESIDUAL", mensaje: aviso.mensaje, fecha: aviso.desde });
    /* GES-9: días con resultado y sin capital sobre el que medirlo. Igual: solo si ya han pasado. */
    if (aviso.codigo === "SIN_CAPITAL" && aviso.desde <= fecha) avisos.push({ gravedad: "aviso", codigo: "SIN_CAPITAL", mensaje: aviso.mensaje, fecha: aviso.desde });
    /* Decisión 2 del 22-11: días sin valoración que no se encadenan. Igual: solo si ya han pasado. */
    if (aviso.codigo === "SIN_VALORAR" && aviso.desde <= fecha) avisos.push({ gravedad: "aviso", codigo: "SIN_VALORAR", mensaje: aviso.mensaje, fecha: aviso.desde });
  }

  for (const grupo of posiblesDuplicados(cartera.movimientos)) {
    const primero = grupo[0];
    const que = primero.activoId ? ` de ${nombre(primero.activoId)}` : "";
    avisos.push({
      gravedad: "aviso",
      codigo: "POSIBLE_DUPLICADO",
      mensaje: `Hay ${grupo.length} movimientos iguales el ${fechaEnTexto(primero.fechaOperacion)}: ${nombreDelTipo(primero.tipo).toLowerCase()}${que}${primero.importe ? ` por ${importeEnTexto(d(primero.importe).abs(), primero.divisa ?? cartera.divisaBase)}` : ""}. Si es el mismo apunte cargado dos veces, borra uno.`,
      movimientoIds: grupo.map((movimiento) => movimiento.id),
      activoId: primero.activoId,
      fecha: primero.fechaOperacion
    });
  }

  /* Los «Otro cargo o abono» que pesan: cuentan como ganancia o como pérdida, y pueden ser una aportación o una retirada sin clasificar. */
  for (const movimiento of cartera.movimientos) {
    if (movimiento.tipo !== "otroEfectivo" || !movimiento.importe || movimiento.fechaOperacion > fecha) continue;
    const dia = valoracion.indice.get(movimiento.fechaOperacion);
    if (dia === undefined) continue;
    const importe = d(movimiento.importe);
    const divisa = movimiento.divisa ?? cartera.divisaBase;
    const enBase = Math.abs(Number(importe)) * valoracion.aBase(divisa, movimiento.fechaOperacion);
    const capital = valoracion.capital[dia];
    if (!(enBase > 0) || (capital > 0 && enBase / capital < PESO_DE_UN_APUNTE_SIN_CLASIFICAR)) continue;
    const abono = importe.gt(0);
    const efecto = capital > 0 ? `: ${abono ? "suma" : "resta"} un ${cifraEnTexto((enBase / capital) * 100, 1)} % a la rentabilidad de ese día` : "";
    avisos.push({
      gravedad: "aviso",
      codigo: "APUNTE_SIN_CLASIFICAR",
      movimientoIds: [movimiento.id],
      fecha: movimiento.fechaOperacion,
      mensaje: `El ${abono ? "abono" : "cargo"} de ${importeEnTexto(importe.abs(), divisa)} del ${fechaEnTexto(movimiento.fechaOperacion)} está sin clasificar («Otro cargo o abono») y cuenta como ${abono ? "ganancia" : "pérdida"}${efecto}. Si es dinero que ha ${abono ? "puesto" : "retirado"} el cliente, cámbialo a ${abono ? "aportación" : "retirada"}.`
    });
  }

  for (const tramo of efectivoEnNegativo(valoracion.libro)) {
    avisos.push({
      gravedad: "aviso",
      codigo: "EFECTIVO_EN_NEGATIVO",
      mensaje: `La cuenta de efectivo queda en negativo desde el ${fechaEnTexto(tramo.desde)} (llega a ${importeEnTexto(tramo.minimo, tramo.divisa)}): falta una aportación o un abono anterior, o sobra un cargo.`,
      fecha: tramo.desde
    });
  }

  /* Precios, a la fecha pedida. */
  const k = valoracion.indice.get(fecha) ?? valoracion.dias.length - 1;
  if (k >= 0) {
    const total = valoracion.valor[k];
    /* La divisa de una posición que tiene precio y no se valora un día porque no hay tipo de cambio (`valoracion.ts`, «sin
       cambio es sin valor»): su fuente es la de una sin precio, y lo que falta no se arregla con un precio a mano sino con el
       cambio. Si además le falta el precio, `undefined`: lo primero que falta es el precio. */
    const sinCambioEl = (serie: SerieDeActivo, i: number): string | undefined => {
      const divisa = cartera.activos.find((activo) => activo.id === serie.activoId)?.divisa;
      return divisa && divisa !== cartera.divisaBase && serie.precio[i] > 0 && !(valoracion.aBase(divisa, valoracion.dias[i]) > 0) ? divisa : undefined;
    };
    /*
     * Los días PASADOS también cuentan (auditoría 16-11-2026, GES-1). Una posición con títulos y sin precio vale cero ese
     * día, y un día a cero deja en −100 % la rentabilidad encadenada de cualquier periodo que lo incluya: antes solo se
     * miraba la fecha pedida, y un hueco de hace meses no avisaba. Y la que se valoró con el precio de su compra hasta que
     * empezó su serie lo dice, porque lo que se movió hasta entonces aparece junto en un solo día.
     */
    for (const serie of valoracion.porActivo.values()) {
      const quien = nombre(serie.activoId);
      let primeroSinPrecio = -1;
      let ultimoSinPrecio = -1;
      let ultimoDeOperacion = -1;
      /* La divisa sin cambio si TODOS los días sin precio lo fueron por falta de cambio; si no, `undefined`. */
      let soloSinCambio: string | undefined;
      for (let i = 0; i <= k; i += 1) {
        if (serie.titulos[i] <= 0) continue;
        if (serie.fuente[i] === FUENTE.sinPrecio) {
          const divisa = sinCambioEl(serie, i);
          soloSinCambio = primeroSinPrecio < 0 || soloSinCambio !== undefined ? divisa : undefined;
          if (primeroSinPrecio < 0) primeroSinPrecio = i;
          ultimoSinPrecio = i;
        } else if (serie.fuente[i] === FUENTE.operacion) ultimoDeOperacion = i;
      }
      /* Si sigue sin precio en la fecha pedida, lo dice el aviso de abajo. */
      if (primeroSinPrecio >= 0 && !(serie.titulos[k] > 0 && serie.fuente[k] === FUENTE.sinPrecio)) {
        const tramo = primeroSinPrecio === ultimoSinPrecio ? `el ${fechaEnTexto(valoracion.dias[primeroSinPrecio])}` : `del ${fechaEnTexto(valoracion.dias[primeroSinPrecio])} al ${fechaEnTexto(valoracion.dias[ultimoSinPrecio])}`;
        avisos.push({
          gravedad: "error",
          codigo: "SIN_PRECIO",
          activoId: serie.activoId,
          fecha: valoracion.dias[primeroSinPrecio],
          mensaje: soloSinCambio
            ? `${quien} no tuvo tipo de cambio ${soloSinCambio}/${cartera.divisaBase} ${tramo}: esos días contó como cero, y la rentabilidad de cualquier periodo que los incluya no vale. Escribe el cambio en sus operaciones.`
            : `${quien} no tuvo precio ${tramo}: esos días contó como cero, y la rentabilidad de cualquier periodo que los incluya no vale. Ponle un precio a mano con fecha ${fechaEnTexto(valoracion.dias[primeroSinPrecio])}.`
        });
      }
      const primeraDeMercado = mercado?.precios.get(serie.activoId)?.[0]?.fecha;
      if (primeraDeMercado !== undefined && ultimoDeOperacion >= 0 && ultimoDeOperacion < k && valoracion.dias[ultimoDeOperacion] < primeraDeMercado) {
        avisos.push({
          gravedad: "nota",
          codigo: "PRECIO_DE_OPERACION",
          activoId: serie.activoId,
          fecha: primeraDeMercado,
          mensaje: `${quien} se valoró al precio de su última operación hasta el ${fechaEnTexto(primeraDeMercado)}, cuando empieza su serie de precios: lo que se movió hasta entonces aparece junto ese día.`
        });
      }
    }
    /*
     * El tipo de cambio también envejece (auditoría 16-11-2026, GES-4). Se usa el último conocido, sin tope: una acción en
     * dólares cuyo cambio acaba el 2 de enero se valoraba el 30 de junio con el cambio de enero, y nada lo decía. El mismo
     * plazo que los precios. Un aviso por divisa, con las posiciones que valora.
     */
    const porDivisa = new Map<string, string[]>();
    for (const serie of valoracion.porActivo.values()) {
      if (serie.titulos[k] <= 0) continue;
      /* Una posición sin precio no se valora con ningún cambio: el aviso decía «con él se valora» de una que no se valora
         (20-11-2026). Lo suyo lo dice el error de más abajo. */
      if (serie.fuente[k] === FUENTE.sinPrecio) continue;
      const divisa = cartera.activos.find((activo) => activo.id === serie.activoId)?.divisa;
      if (!divisa || divisa === cartera.divisaBase) continue;
      porDivisa.set(divisa, [...(porDivisa.get(divisa) ?? []), nombre(serie.activoId)]);
    }
    for (const [divisa, posiciones] of porDivisa) {
      const delCambio = valoracion.fechaDelCambio(divisa, valoracion.dias[k]);
      if (!delCambio) continue;
      const dias = diasEntre(delCambio, valoracion.dias[k]);
      if (dias <= DIAS_DE_PRECIO_ANTIGUO) continue;
      avisos.push({
        gravedad: "aviso",
        codigo: "CAMBIO_ANTIGUO",
        fecha: delCambio,
        mensaje: `El último tipo de cambio ${divisa}/${cartera.divisaBase} es del ${fechaEnTexto(delCambio)}, de hace ${dias} días: con él se ${posiciones.length === 1 ? "valora" : "valoran"} ${posiciones.join(", ")}.`
      });
    }
    for (const serie of valoracion.porActivo.values()) {
      if (serie.titulos[k] <= 0) continue;
      const fuente = serie.fuente[k];
      const quien = nombre(serie.activoId);
      if (fuente === FUENTE.sinPrecio) {
        const divisa = sinCambioEl(serie, k);
        const que = divisa ? `no tiene tipo de cambio ${divisa}/${cartera.divisaBase}` : "no tiene precio";
        avisos.push({ gravedad: "error", codigo: "SIN_PRECIO", activoId: serie.activoId, mensaje: `${quien} ${que}: cuenta como cero, y la rentabilidad de cualquier periodo que incluya esta fecha no vale. ${divisa ? "Escribe el cambio en sus operaciones." : "Ponle un precio a mano."}` });
      } else if (fuente === FUENTE.operacion) {
        const conSerie = (mercado?.precios.get(serie.activoId)?.length ?? 0) > 0;
        avisos.push({ gravedad: "aviso", codigo: "PRECIO_DE_OPERACION", activoId: serie.activoId, mensaje: `${quien} ${conSerie ? "aún no tiene precios en su serie" : "no tiene serie de precios"}: se valora al precio de su última operación, de hace ${serie.antiguedad[k]} días. Ponle un precio a mano para actualizarlo.` });
      } else if (fuente === FUENTE.manual) {
        avisos.push({ gravedad: "nota", codigo: "PRECIO_A_MANO", activoId: serie.activoId, mensaje: `${quien} se valora con un precio puesto a mano${serie.antiguedad[k] > 0 ? `, de hace ${serie.antiguedad[k]} días` : ""}.` });
      } else if (fuente === FUENTE.extracto) {
        avisos.push({ gravedad: "nota", codigo: "PRECIO_DEL_EXTRACTO", activoId: serie.activoId, mensaje: `${quien} se valora con el precio del extracto del banco${serie.antiguedad[k] > 0 ? `, de hace ${serie.antiguedad[k]} días` : ""}: es más reciente que el de la plataforma.` });
      } else if (serie.antiguedad[k] > DIAS_DE_PRECIO_ANTIGUO) {
        avisos.push({ gravedad: "aviso", codigo: "PRECIO_ANTIGUO", activoId: serie.activoId, mensaje: `El último precio de ${quien} es de hace ${serie.antiguedad[k]} días.` });
      }
      if (total > 0 && serie.valor[k] / total > PESO_DE_CONCENTRACION) {
        avisos.push({ gravedad: "nota", codigo: "CONCENTRACION", activoId: serie.activoId, mensaje: `${quien} pesa un ${cifraEnTexto((serie.valor[k] / total) * 100, 1)} % de la cartera.` });
      }
    }
  }

  const conciliaciones = cartera.extractos.map((extracto) => conciliar(cartera, extracto)).sort((a, b) => (a.extracto.fecha < b.extracto.fecha ? 1 : -1));
  /* Cada extracto se concilia a SU fecha, así que avisan todos los que no cuadran, no solo el último. */
  for (const conciliacion of conciliaciones) {
    if (conciliacion.cuadra) continue;
    const n = conciliacion.diferencias.length;
    avisos.push({
      gravedad: "aviso",
      codigo: "NO_CUADRA_CON_EL_EXTRACTO",
      fecha: conciliacion.extracto.fecha,
      mensaje: `La cartera no cuadra con el extracto del ${fechaEnTexto(conciliacion.extracto.fecha)}: ${n === 1 ? "hay una diferencia" : `hay ${n} diferencias`}.`
    });
  }
  if (mercado) avisos.push(...preciosAlejados(cartera, valoracion, mercado, nombre));
  if (mercado?.ajustadasPorDividendos) avisos.push(...dividendosConLaPosicionCambiada(valoracion.libro, mercado.ajustadasPorDividendos, nombre, fecha));

  const orden: Record<GravedadDelAviso, number> = { error: 0, aviso: 1, nota: 2 };
  avisos.sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
  return {
    avisos,
    conciliaciones,
    errores: avisos.filter((aviso) => aviso.gravedad === "error").length,
    advertencias: avisos.filter((aviso) => aviso.gravedad === "aviso").length
  };
}
