/**
 * El libro: aplica los movimientos de una cartera, por orden, a sus dos cuentas.
 *
 *  - Cuenta de efectivo: un saldo por divisa (más el efectivo en tránsito de los traspasos).
 *  - Cuenta de valores: por activo, sus lotes de compra. Las salidas consumen los lotes más
 *    antiguos primero (FIFO) y dejan el resultado realizado de cada tramo.
 *
 * LAS ENTRADAS DEL MISMO ACTIVO EN EL MISMO DÍA SON UN SOLO LOTE, a su coste medio (decisión
 * de la dirección, 13-11-2026). El libro no tiene hora de ejecución: entre dos compras del mismo
 * día ningún orden es más cierto que otro, y el FIFO no puede decir cuál es «la primera». Antes
 * decidía el orden del fichero, y la misma cartera daba un realizado distinto según cómo se
 * tecleó o se importó. Con el lote único, lo que se vende de ese día sale al coste medio del
 * día; el realizado más el latente no cambia. Vale para toda entrada con la misma fecha de lote:
 * compras, entradas de títulos y lotes que llegan de un canje con su fecha original.
 *
 * El libro solo entiende los efectos de `efectos.ts`. No sabe qué es una compra ni un
 * dividendo: eso lo dice cada tipo en `movimientos/`. Es cálculo puro: ni red ni disco.
 */
import { CERO, cifraEnTexto, d, type Decimal } from "./decimal";
import type { ContextoDeMovimiento, Efecto, ImporteEnDivisa } from "./efectos";
import { fechaEnTexto, type Dia } from "./fechas";
import { divisaDelEfectivo, type Activo, type Cartera, type Movimiento } from "./modelo";
import { definicionDe } from "./movimientos/registro";

/** Un lote de compra: los títulos que quedan de una entrada, con su coste. */
export interface Lote {
  id: string;
  activoId: string;
  movimientoId: string;
  /** Fecha de la compra que lo abrió. Un canje o un split la conservan. */
  fecha: Dia;
  titulos: Decimal;
  /** Coste de los títulos que quedan, en la divisa base, con comisiones. */
  costeBase: Decimal;
  /** El mismo coste en la divisa del activo, si se pudo calcular. */
  costeLocal?: Decimal;
  /** Falta un tipo de cambio para conocer el coste: la cifra no se puede dar. */
  costeIncompleto: boolean;
}

/** El resultado de un tramo de títulos vendido: un lote (o parte) contra una salida. */
export interface Realizado {
  activoId: string;
  movimientoId: string;
  fechaCompra: Dia;
  fechaVenta: Dia;
  titulos: Decimal;
  costeBase: Decimal;
  cobradoBase: Decimal;
  resultado: Decimal;
  incompleto: boolean;
}

export interface EstadoDeLasCuentas {
  /** Saldo de la cuenta de efectivo por divisa. */
  efectivo: Map<string, Decimal>;
  /** Efectivo de traspasos en curso, por divisa: patrimonio que no está en el extracto del banco. */
  transito: Map<string, Decimal>;
  /** Lotes abiertos por activo, del más antiguo al más reciente. */
  lotes: Map<string, Lote[]>;
}

/** Un efecto ya aplicado, con su fecha y su movimiento. */
export interface Apunte {
  orden: number;
  /** Fecha en la que cuenta: la de operación o la propia del efecto. */
  fecha: Dia;
  fechaValor: Dia;
  movimiento: Movimiento;
  efecto: Efecto;
}

export type CodigoDeAviso = "TIPO_DESCONOCIDO" | "MOVIMIENTO_NO_VALIDO" | "DESCUBIERTO_DE_TITULOS" | "FALTA_EL_CAMBIO";

export interface AvisoDelLibro {
  nivel: "error" | "aviso";
  codigo: CodigoDeAviso;
  movimientoId: string;
  fecha: Dia;
  mensaje: string;
}

/** Un split aplicado: la valoración lo necesita para leer una serie de precios ya ajustada. */
export interface AjusteDeTitulos {
  fecha: Dia;
  factor: Decimal;
  serieAjustada: boolean;
}

export interface Libro {
  divisaBase: string;
  apuntes: Apunte[];
  realizados: Realizado[];
  avisos: AvisoDelLibro[];
  ajustes: Map<string, AjusteDeTitulos[]>;
  /** El estado de las cuentas tras el último apunte aplicado. */
  final: EstadoDeLasCuentas;
  primeraFecha?: Dia;
  ultimaFecha?: Dia;
}

export interface OpcionesDelLibro {
  /**
   * Cambio de mercado: unidades de `divisa` por 1 unidad de la divisa base ese día (o el
   * último conocido). Solo se usa cuando el movimiento no trae su propio cambio.
   */
  cambio?: (divisa: string, fecha: Dia) => number | undefined;
  /** Aplica solo los apuntes hasta este día, incluido. */
  hasta?: Dia;
  /** Qué fecha manda al cortar con `hasta`: la de operación (por defecto) o la de valor. */
  criterio?: "operacion" | "valor";
  /** Se llama al cerrar cada día que tuvo apuntes, con el estado tal como queda. No lo guardes: cópialo. */
  alCerrarElDia?: (dia: Dia, estado: EstadoDeLasCuentas, apuntesDelDia: Apunte[]) => void;
}

export function contextoDe(cartera: Cartera): ContextoDeMovimiento {
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  return { divisaBase: cartera.divisaBase, activo: (activoId) => (activoId === undefined ? undefined : porId.get(activoId)) };
}

/** Los errores de un movimiento según su tipo. Lista vacía: es válido. */
export function validarMovimiento(movimiento: Movimiento, contexto: ContextoDeMovimiento): string[] {
  const definicion = definicionDe(movimiento.tipo);
  if (!definicion) return [`No existe el tipo de movimiento «${movimiento.tipo}».`];
  return definicion.validar(movimiento, contexto);
}

/** Los movimientos en el orden en que se aplican: por fecha, dentro del día por el orden de su tipo, y a igualdad por su posición en el libro. */
export function ordenarMovimientos(movimientos: readonly Movimiento[]): Movimiento[] {
  return movimientos
    .map((movimiento, indice) => ({ movimiento, indice, orden: definicionDe(movimiento.tipo)?.orden ?? 100 }))
    .sort((a, b) =>
      a.movimiento.fechaOperacion < b.movimiento.fechaOperacion ? -1
        : a.movimiento.fechaOperacion > b.movimiento.fechaOperacion ? 1
          : a.orden - b.orden || a.indice - b.indice)
    .map((item) => item.movimiento);
}

function sumarEn(mapa: Map<string, Decimal>, clave: string, importe: Decimal): void {
  mapa.set(clave, (mapa.get(clave) ?? CERO).plus(importe));
}

/** La divisa a la que se refiere el `cambio` de un movimiento: la del efectivo si no es la base; si lo es, la del activo. */
function divisaDelCambio(movimiento: Movimiento, divisaBase: string, activo: Activo | undefined): string | undefined {
  const efectivo = divisaDelEfectivo(movimiento, divisaBase);
  return efectivo !== divisaBase ? efectivo : activo?.divisa;
}

export function construirLibro(cartera: Cartera, opciones: OpcionesDelLibro = {}): Libro {
  const contexto = contextoDe(cartera);
  const base = cartera.divisaBase;
  const avisos: AvisoDelLibro[] = [];
  const realizados: Realizado[] = [];
  const ajustes = new Map<string, AjusteDeTitulos[]>();
  const estado: EstadoDeLasCuentas = { efectivo: new Map(), transito: new Map(), lotes: new Map() };

  /* 1. De movimientos a apuntes fechados. */
  const pendientes: Apunte[] = [];
  let orden = 0;
  for (const movimiento of ordenarMovimientos(cartera.movimientos)) {
    const definicion = definicionDe(movimiento.tipo);
    if (!definicion) {
      avisos.push({ nivel: "error", codigo: "TIPO_DESCONOCIDO", movimientoId: movimiento.id, fecha: movimiento.fechaOperacion, mensaje: `No existe el tipo de movimiento «${movimiento.tipo}»: el movimiento no se ha aplicado.` });
      continue;
    }
    const errores = definicion.validar(movimiento, contexto);
    if (errores.length > 0) {
      avisos.push({ nivel: "error", codigo: "MOVIMIENTO_NO_VALIDO", movimientoId: movimiento.id, fecha: movimiento.fechaOperacion, mensaje: `${definicion.nombre} del ${fechaEnTexto(movimiento.fechaOperacion)} sin aplicar: ${errores.join(" ")}` });
      continue;
    }
    for (const efecto of definicion.efectos(movimiento, contexto)) {
      const propia = "fecha" in efecto ? efecto.fecha : undefined;
      pendientes.push({
        orden: orden += 1,
        fecha: propia ?? movimiento.fechaOperacion,
        fechaValor: propia ?? movimiento.fechaValor ?? movimiento.fechaOperacion,
        movimiento,
        efecto
      });
    }
  }
  pendientes.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orden - b.orden));

  /* 2. Conversión a la divisa base de un importe de un movimiento. */
  const aBase = (importe: ImporteEnDivisa, apunte: Apunte, activo: Activo | undefined): { valor: Decimal; incompleto: boolean } => {
    if (importe.divisa === base || importe.importe.eq(0)) return { valor: importe.importe, incompleto: false };
    const propio = apunte.movimiento.cambio;
    if (propio && divisaDelCambio(apunte.movimiento, base, activo) === importe.divisa) {
      return { valor: importe.importe.div(d(propio)), incompleto: false };
    }
    const mercado = opciones.cambio?.(importe.divisa, apunte.fecha);
    if (mercado !== undefined && mercado > 0) return { valor: importe.importe.div(d(mercado)), incompleto: false };
    avisos.push({
      nivel: "error",
      codigo: "FALTA_EL_CAMBIO",
      movimientoId: apunte.movimiento.id,
      fecha: apunte.fecha,
      mensaje: `No hay tipo de cambio ${importe.divisa}/${base} para el ${fechaEnTexto(apunte.fecha)}: añade el cambio de la operación para conocer su coste.`
    });
    return { valor: CERO, incompleto: true };
  };

  const aLocal = (pagado: ImporteEnDivisa, enBase: { valor: Decimal; incompleto: boolean }, apunte: Apunte, activo: Activo | undefined): Decimal | undefined => {
    if (!activo) return undefined;
    if (pagado.divisa === activo.divisa) return pagado.importe;
    if (enBase.incompleto) return undefined;
    if (activo.divisa === base) return enBase.valor;
    const propio = apunte.movimiento.cambio;
    if (propio && divisaDelCambio(apunte.movimiento, base, activo) === activo.divisa) return enBase.valor.times(d(propio));
    const mercado = opciones.cambio?.(activo.divisa, apunte.fecha);
    return mercado !== undefined && mercado > 0 ? enBase.valor.times(d(mercado)) : undefined;
  };

  const lotesDe = (activoId: string): Lote[] => {
    let lotes = estado.lotes.get(activoId);
    if (!lotes) {
      lotes = [];
      estado.lotes.set(activoId, lotes);
    }
    return lotes;
  };

  const insertarLote = (lote: Lote): void => {
    const lotes = lotesDe(lote.activoId);
    /*
     * Un lote del mismo día se suma al que ya hay: un solo lote, a su coste medio (cabecera). Lleva el id del
     * movimiento menor, no el del primero en el fichero, para que tampoco eso dependa del orden.
     */
    const delMismoDia = lotes.findIndex((otro) => otro.fecha === lote.fecha);
    if (delMismoDia >= 0) {
      const otro = lotes[delMismoDia];
      lotes[delMismoDia] = {
        ...(lote.movimientoId < otro.movimientoId ? lote : otro),
        titulos: otro.titulos.plus(lote.titulos),
        costeBase: otro.costeBase.plus(lote.costeBase),
        costeLocal: otro.costeLocal !== undefined && lote.costeLocal !== undefined ? otro.costeLocal.plus(lote.costeLocal) : undefined,
        costeIncompleto: otro.costeIncompleto || lote.costeIncompleto
      };
      return;
    }
    /* Por antigüedad: un canje trae lotes con su fecha de compra original. */
    let posicion = lotes.length;
    while (posicion > 0 && lotes[posicion - 1].fecha > lote.fecha) posicion -= 1;
    lotes.splice(posicion, 0, lote);
  };

  /** Saca `titulos` de los lotes más antiguos. Devuelve los tramos sacados y lo que no se pudo cubrir. */
  const consumir = (activoId: string, titulos: Decimal): { tramos: Lote[]; sinCubrir: Decimal } => {
    const lotes = lotesDe(activoId);
    const tramos: Lote[] = [];
    let falta = titulos;
    while (falta.gt(0) && lotes.length > 0) {
      const lote = lotes[0];
      if (lote.titulos.lte(falta)) {
        tramos.push(lote);
        falta = falta.minus(lote.titulos);
        lotes.shift();
      } else {
        const proporcion = falta.div(lote.titulos);
        const coste = lote.costeBase.times(proporcion);
        const costeLocal = lote.costeLocal?.times(proporcion);
        tramos.push({ ...lote, titulos: falta, costeBase: coste, costeLocal });
        lote.titulos = lote.titulos.minus(falta);
        lote.costeBase = lote.costeBase.minus(coste);
        lote.costeLocal = lote.costeLocal && costeLocal ? lote.costeLocal.minus(costeLocal) : lote.costeLocal;
        falta = CERO;
      }
    }
    if (lotes.length === 0) estado.lotes.delete(activoId);
    return { tramos, sinCubrir: falta };
  };

  const avisarDescubierto = (apunte: Apunte, activoId: string, pedidos: Decimal, sinCubrir: Decimal): void => {
    const nombre = contexto.activo(activoId)?.nombre ?? activoId;
    avisos.push({
      nivel: "error",
      codigo: "DESCUBIERTO_DE_TITULOS",
      movimientoId: apunte.movimiento.id,
      fecha: apunte.fecha,
      mensaje: `El ${fechaEnTexto(apunte.fecha)} salen ${cifraEnTexto(pedidos)} títulos de ${nombre} y solo había ${cifraEnTexto(pedidos.minus(sinCubrir))}: falta una compra o una entrada de títulos anterior.`
    });
  };

  const aplicar = (apunte: Apunte): void => {
    const efecto = apunte.efecto;
    switch (efecto.clase) {
      case "efectivo":
        sumarEn(efecto.transito ? estado.transito : estado.efectivo, efecto.divisa, efecto.importe);
        return;
      case "alta": {
        const activo = contexto.activo(efecto.activoId);
        const enBase = aBase(efecto.pagado, apunte, activo);
        insertarLote({
          id: `${apunte.movimiento.id}:${apunte.orden}`,
          activoId: efecto.activoId,
          movimientoId: apunte.movimiento.id,
          fecha: apunte.fecha,
          titulos: efecto.titulos,
          costeBase: enBase.valor,
          costeLocal: aLocal(efecto.pagado, enBase, apunte, activo),
          costeIncompleto: enBase.incompleto
        });
        return;
      }
      case "baja": {
        const activo = contexto.activo(efecto.activoId);
        const { tramos, sinCubrir } = consumir(efecto.activoId, efecto.titulos);
        if (sinCubrir.gt(0)) avisarDescubierto(apunte, efecto.activoId, efecto.titulos, sinCubrir);
        if (!efecto.realiza) return;
        const cobrado = aBase(efecto.cobrado, apunte, activo);
        let repartido = CERO;
        tramos.forEach((tramo, indice) => {
          /* Lo cobrado se reparte por títulos; el último tramo cubierto se lleva el resto, para que la suma sea exacta. */
          const esUltimo = indice === tramos.length - 1 && sinCubrir.eq(0);
          const parte = esUltimo ? cobrado.valor.minus(repartido) : cobrado.valor.times(tramo.titulos).div(efecto.titulos);
          repartido = repartido.plus(parte);
          realizados.push({
            activoId: efecto.activoId,
            movimientoId: apunte.movimiento.id,
            fechaCompra: tramo.fecha,
            fechaVenta: apunte.fecha,
            titulos: tramo.titulos,
            costeBase: tramo.costeBase,
            cobradoBase: parte,
            resultado: parte.minus(tramo.costeBase),
            incompleto: tramo.costeIncompleto || cobrado.incompleto
          });
        });
        if (sinCubrir.gt(0)) {
          /* Títulos vendidos que el libro no tenía: se sabe lo cobrado, no lo que costaron. */
          const parte = cobrado.valor.minus(repartido);
          realizados.push({
            activoId: efecto.activoId,
            movimientoId: apunte.movimiento.id,
            fechaCompra: apunte.fecha,
            fechaVenta: apunte.fecha,
            titulos: sinCubrir,
            costeBase: CERO,
            cobradoBase: parte,
            resultado: parte,
            incompleto: true
          });
        }
        return;
      }
      case "ajusteDeTitulos": {
        for (const lote of estado.lotes.get(efecto.activoId) ?? []) lote.titulos = lote.titulos.times(efecto.factor);
        const lista = ajustes.get(efecto.activoId) ?? [];
        lista.push({ fecha: apunte.fecha, factor: efecto.factor, serieAjustada: efecto.serieAjustada });
        ajustes.set(efecto.activoId, lista);
        return;
      }
      case "canje": {
        const disponibles = (estado.lotes.get(efecto.activoId) ?? []).reduce((suma, lote) => suma.plus(lote.titulos), CERO);
        const canjeados = efecto.titulos ?? disponibles;
        if (canjeados.lte(0)) {
          avisarDescubierto(apunte, efecto.activoId, canjeados, CERO);
          return;
        }
        const { tramos, sinCubrir } = consumir(efecto.activoId, canjeados);
        if (sinCubrir.gt(0)) avisarDescubierto(apunte, efecto.activoId, canjeados, sinCubrir);
        const cubiertos = canjeados.minus(sinCubrir);
        if (cubiertos.lte(0)) return;
        const destino = contexto.activo(efecto.destinoId);
        const origen = contexto.activo(efecto.activoId);
        tramos.forEach((tramo, indice) => {
          insertarLote({
            ...tramo,
            id: `${apunte.movimiento.id}:${apunte.orden}:${indice}`,
            activoId: efecto.destinoId,
            titulos: tramo.titulos.times(efecto.titulosDestino).div(canjeados),
            /* El coste local solo se conserva si los dos activos cotizan en la misma divisa. */
            costeLocal: destino && origen && destino.divisa === origen.divisa ? tramo.costeLocal : undefined
          });
        });
        return;
      }
      case "flujoExterno":
      case "ingreso":
      case "coste":
        /* No cambian las cuentas: su pata de efectivo ya va en un efecto «efectivo». Quedan en los apuntes para el análisis. */
        return;
    }
  };

  /* 3. Se aplican por días. */
  const criterio = opciones.criterio ?? "operacion";
  const apuntes: Apunte[] = [];
  let delDia: Apunte[] = [];
  const cerrarDia = (): void => {
    if (delDia.length > 0) opciones.alCerrarElDia?.(delDia[0].fecha, estado, delDia);
    delDia = [];
  };
  for (const apunte of pendientes) {
    const corte = criterio === "valor" ? apunte.fechaValor : apunte.fecha;
    if (opciones.hasta !== undefined && corte > opciones.hasta) continue;
    if (delDia.length > 0 && delDia[0].fecha !== apunte.fecha) cerrarDia();
    aplicar(apunte);
    apuntes.push(apunte);
    delDia.push(apunte);
  }
  cerrarDia();

  return {
    divisaBase: base,
    apuntes,
    realizados,
    avisos,
    ajustes,
    final: estado,
    primeraFecha: apuntes[0]?.fecha,
    ultimaFecha: apuntes[apuntes.length - 1]?.fecha
  };
}

/** Los títulos de un activo en un estado de las cuentas. */
export function titulosDe(estado: EstadoDeLasCuentas, activoId: string): Decimal {
  return (estado.lotes.get(activoId) ?? []).reduce((suma, lote) => suma.plus(lote.titulos), CERO);
}

/** Una posición de la cuenta de valores: los lotes de un activo, sumados. */
export interface PosicionEnLibros {
  activoId: string;
  titulos: Decimal;
  costeBase: Decimal;
  costeLocal?: Decimal;
  costeIncompleto: boolean;
  /** Fecha del lote más antiguo que queda. */
  desde: Dia;
  lotes: Lote[];
}

export function posicionesDe(estado: EstadoDeLasCuentas): PosicionEnLibros[] {
  const posiciones: PosicionEnLibros[] = [];
  for (const [activoId, lotes] of estado.lotes) {
    const titulos = lotes.reduce((suma, lote) => suma.plus(lote.titulos), CERO);
    if (titulos.lte(0)) continue;
    const conLocal = lotes.every((lote) => lote.costeLocal !== undefined);
    posiciones.push({
      activoId,
      titulos,
      costeBase: lotes.reduce((suma, lote) => suma.plus(lote.costeBase), CERO),
      costeLocal: conLocal ? lotes.reduce((suma, lote) => suma.plus(lote.costeLocal!), CERO) : undefined,
      costeIncompleto: lotes.some((lote) => lote.costeIncompleto),
      desde: lotes[0].fecha,
      lotes
    });
  }
  return posiciones;
}

/**
 * El estado de las dos cuentas a una fecha. Por defecto manda la fecha de operación; con
 * `criterio: "valor"`, la fecha valor (el saldo que el banco considera disponible ese día).
 */
export function cuentasA(cartera: Cartera, fecha: Dia, opciones: Pick<OpcionesDelLibro, "cambio" | "criterio"> = {}): Libro {
  return construirLibro(cartera, { ...opciones, hasta: fecha });
}

/** Una línea del extracto de la cuenta de efectivo: un movimiento con su efecto neto y el saldo que deja. */
export interface LineaDeEfectivo {
  movimiento: Movimiento;
  fecha: Dia;
  fechaValor: Dia;
  divisa: string;
  importe: Decimal;
  saldo: Decimal;
}

/**
 * El extracto de la cuenta de efectivo en una divisa: una línea por movimiento que la toca,
 * con el saldo acumulado. El efectivo en tránsito no entra: no está en la cuenta del banco.
 */
export function extractoDeEfectivo(libro: Libro, divisa: string): LineaDeEfectivo[] {
  const lineas: LineaDeEfectivo[] = [];
  let saldo = CERO;
  for (const apunte of libro.apuntes) {
    const efecto = apunte.efecto;
    if (efecto.clase !== "efectivo" || efecto.transito || efecto.divisa !== divisa) continue;
    saldo = saldo.plus(efecto.importe);
    const ultima = lineas[lineas.length - 1];
    if (ultima && ultima.movimiento.id === apunte.movimiento.id && ultima.fecha === apunte.fecha) {
      ultima.importe = ultima.importe.plus(efecto.importe);
      ultima.saldo = saldo;
    } else {
      lineas.push({ movimiento: apunte.movimiento, fecha: apunte.fecha, fechaValor: apunte.fechaValor, divisa, importe: efecto.importe, saldo });
    }
  }
  return lineas;
}
