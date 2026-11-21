/**
 * De lo leído en los documentos de Andbank a movimientos propuestos para el libro.
 *
 * Cada fila del extracto de movimientos de efectivo es un movimiento. El export de
 * operaciones dice qué activo es cada una (ISIN, títulos exactos, precio) y trae lo que no
 * pasa por el efectivo: traspasos entre fondos y canjes. El extracto de posiciones identifica
 * por el nombre lo que el de operaciones no cubre y declara lo que hay a su fecha.
 *
 * Nada se inventa: lo que no se puede proponer con seguridad se propone marcado para revisar,
 * o se lista en los avisos para que el asesor lo dé de alta a mano. Las reglas de
 * emparejado salen de `functions_python/portfolio_real/mapping.py` y `service.py`, en la etiqueta
 * de Git `referencia-portfolio-real-2026-11-17`.
 *
 * LA IDENTIDAD DE UNA FILA DEL EFECTIVO, por este orden: su operación del export (fecha con tres
 * días de margen, importe al céntimo y títulos; a igualdad de días, la de importe exacto y luego
 * el nombre); la posición cuyo nombre casa; y, si no, `resolve_operations_mapping`: el ISIN único
 * de las operaciones con ese nombre, o el que votan todas las demás filas del mismo nombre que sí
 * están enlazadas. Si nada de eso da un único ISIN, la fila va solo por su nombre, por revisar.
 *
 * LOS TRASPASOS ENTRE FONDOS se emparejan en cuatro pasadas, cada una con lo que dejan suelto las
 * anteriores: uno a uno; una salida repartida en varias entradas de un mismo día; varias salidas de
 * un día que entran en un fondo; y por OLEADAS, la traslación de `_transfer_legs_close` de
 * `service.py`. Una oleada son patas sueltas de la misma divisa encadenadas: cada entrada cae entre
 * 0 y `DIAS_DE_UN_TRASPASO` días después de alguna salida de la oleada. Si lo que sale y lo que
 * entra en toda la oleada cierra con la tolerancia de un traspaso aplicada a la suma, el dinero se
 * reparte en orden de fecha (cada salida cubre las entradas más antiguas que queden) y cada parte
 * es un traspaso, con los títulos de cada pata en proporción a su importe y el resto en la última
 * parte de cada una. Si no cierra, falta la otra mitad de alguna pata: las patas se proponen como
 * entrada y salida de títulos, que es patrimonio que entra o sale, por revisar.
 */
import { CERO, aTexto, d, redondear, type Decimal } from "../../motor/decimal";
import { diasEntre, type Dia } from "../../motor/fechas";
import type { Movimiento, TipoDeActivo } from "../../motor/modelo";
import type { ActivoCitado, ExtractoPropuesto, MovimientoPropuesto } from "../tipos";
import { fechaEnTexto, importeEnTexto, nombresCasan, normalizarNombre } from "./comun";
import { esDevolucionDePrima, type ClaseDeMovimiento, type ExtractoDeMovimientos, type FilaDeMovimiento } from "./movimientos";
import type { OperacionLeida } from "./operaciones";
import { tipoDeLaClase, type ExtractoDePosiciones, type PosicionLeida } from "./posiciones";

export interface EntradaDeLaPropuesta {
  divisaBase: string;
  movimientos?: ExtractoDeMovimientos;
  posiciones?: ExtractoDePosiciones;
  operaciones: OperacionLeida[];
}

export interface Propuesta {
  movimientos: MovimientoPropuesto[];
  extractos: ExtractoPropuesto[];
  avisos: string[];
}

/* ------------------------------------------------------------------ constantes */

type ClaseConOperacion = "COMPRA" | "VENTA" | "SUSCRIPCION" | "REEMBOLSO" | "DIVIDENDO";

/** `_COMPATIBLE_OPERATION_TYPES` de `mapping.py`: con qué tipos del export de operaciones casa cada clase de movimiento. */
const TIPOS_COMPATIBLES: Record<ClaseConOperacion, readonly string[]> = {
  COMPRA: ["COMPRA"],
  VENTA: ["VENTA"],
  SUSCRIPCION: ["SUSCRIPCION", "SUSCRIPCION RV", "SUSCRIPCION LIBERADA", "SUSCRIPCION FUSION"],
  REEMBOLSO: ["REEMBOLSO", "REEMBOLSO FUSION"],
  /* La devolución de prima de emisión es remuneración en efectivo, como un dividendo: no está en Python. */
  DIVIDENDO: ["DIVIDENDO", "DEVOL.PRIMA EMISION"]
};

/**
 * Tipos del export que solo describen un apunte de efectivo: si el extracto de la cuenta cubre su
 * fecha, ese apunte ya está allí, y darlos de alta a mano lo duplicaría.
 */
const SOLO_EFECTIVO = ["DEVOL.PRIMA EMISION", "CARGO MANTENIMIENTO", "ABONO POR PENALIZACI"] as const;
const esSoloEfectivo = (tipo: string) => SOLO_EFECTIVO.some((prefijo) => tipo.startsWith(prefijo));

/** Los derechos de suscripción: se asignan sin coste y salen al ejercerlos o venderlos. */
const ALTA_DE_DERECHOS = "ALTA DCHOS. SUSCRIP.";
const EJERCICIO_DE_DERECHOS = "EJERCICIO DERECHOS";

/** Las suscripciones del export que son de acciones, no de fondos: ampliaciones y acciones liberadas. */
const SUSCRIPCIONES_DE_ACCIONES = ["SUSCRIPCION RV", "SUSCRIPCION LIBERADA"];

/** Lo que mide, como poco, un concepto que el banco ha cortado a 30 caracteres después de que el lector juntara sus espacios repetidos. */
const LARGO_DE_UN_CONCEPTO_QUIZA_CORTADO = 28;

/** Los abonos del banco que no son de ningún activo: retrocesiones, penalizaciones a favor, anulaciones y devoluciones. */
const ABONO_DEL_BANCO = /RETRO|ABONO|ANULACI|DEVOL|PENALIZ/;

const TIPO_DEL_MOVIMIENTO: Record<ClaseConOperacion, string> = {
  COMPRA: "compra",
  VENTA: "venta",
  SUSCRIPCION: "suscripcion",
  REEMBOLSO: "reembolso",
  DIVIDENDO: "dividendo"
};

/** El signo que exige el motor al importe de cada clase: −1 sale efectivo, +1 entra. */
const SIGNO_DE_LA_CLASE: Record<ClaseConOperacion | "COMISION", -1 | 1> = {
  COMPRA: -1,
  SUSCRIPCION: -1,
  VENTA: 1,
  REEMBOLSO: 1,
  DIVIDENDO: 1,
  COMISION: -1
};

const NOMBRE_DE_LA_CLASE: Record<ClaseConOperacion | "COMISION", string> = {
  COMPRA: "una compra",
  SUSCRIPCION: "una suscripción",
  VENTA: "una venta",
  REEMBOLSO: "un reembolso",
  DIVIDENDO: "un dividendo",
  COMISION: "una comisión"
};

/** `OPERATION_LINK_MAX_DAYS` y `OPERATION_LINK_MAX_AMOUNT_DIFF` de `mapping.py`. */
const DIAS_DE_MARGEN = 3;
const DIFERENCIA_MAXIMA = d("0.011");
/** Días de margen entre una «compra» del efectivo y su cargo de gastos de mercado: los mismos que el lector del servidor, medidos con extractos reales. */
const DIAS_DE_MARGEN_DEL_CARGO = 3;
/** Días que puede tardar en entrar el fondo de destino de un traspaso. */
const DIAS_DE_UN_TRASPASO = 10;
/** Cuántas entradas o salidas de un mismo día se combinan, como mucho, al buscar un reparto. */
const MAXIMO_DE_CANDIDATAS = 12;
const MAXIMO_DE_PARTES = 6;

const AVISO_TITULOS_CORTADOS = "El banco corta el concepto a 30 caracteres: comprueba el número de títulos.";
const AVISO_FALTA_IMPORTE = "Falta el importe en euros: complétalo antes de importar.";
const AVISO_SIN_APUNTE = "No se ha encontrado su apunte en la cuenta de efectivo.";

function esClaseConOperacion(clase: string): clase is ClaseConOperacion {
  return clase in TIPOS_COMPATIBLES;
}

function claseDeLaOperacion(tipo: string): ClaseConOperacion | undefined {
  return (Object.keys(TIPOS_COMPATIBLES) as ClaseConOperacion[]).find((clase) => TIPOS_COMPATIBLES[clase].includes(tipo));
}

/** `max(0,05; 0,1 %)` del importe: lo que puede descuadrar un traspaso porque el banco redondea participaciones. */
function toleranciaDeTraspaso(importe: Decimal): Decimal {
  const relativa = importe.abs().times("0.001");
  return relativa.gt("0.05") ? relativa : d("0.05");
}

function decimalesDe(valor: Decimal): number {
  const texto = aTexto(valor);
  const punto = texto.indexOf(".");
  return punto < 0 ? 0 : texto.length - punto - 1;
}

function titulosEnTexto(valor: Decimal): string {
  return aTexto(valor).replace(".", ",");
}

/* ------------------------------------------------------------------ la propuesta */

export function proponer(entrada: EntradaDeLaPropuesta): Propuesta {
  const { divisaBase } = entrada;
  const filas = entrada.movimientos?.filas ?? [];
  const posiciones = entrada.posiciones?.posiciones ?? [];
  const operaciones = entrada.operaciones;
  const avisos: string[] = [];
  const propuestos: Array<{ propuesto: MovimientoPropuesto; orden: number }> = [];
  /* Las filas del efectivo van antes que las operaciones a igualdad de fecha: es el orden de los extractos. */
  const ORDEN_DE_OPERACIONES = 1_000_000;

  const posicionPorIsin = new Map<string, PosicionLeida>();
  for (const posicion of posiciones) if (!posicionPorIsin.has(posicion.isin)) posicionPorIsin.set(posicion.isin, posicion);

  /* ---------------- activos citados */

  const tipoDelIsin = (isin: string, defecto?: TipoDeActivo): TipoDeActivo | undefined => {
    const posicion = posicionPorIsin.get(isin);
    return posicion ? tipoDeLaClase(posicion.clase) : defecto;
  };
  const citarOperacion = (operacion: OperacionLeida, defecto?: TipoDeActivo): ActivoCitado => {
    const divisa = operacion.divisa ?? posicionPorIsin.get(operacion.isin)?.divisa;
    const tipo = tipoDelIsin(operacion.isin, defecto);
    return { clave: operacion.isin, isin: operacion.isin, nombre: operacion.nombre, ...(divisa ? { divisa } : {}), ...(tipo ? { tipo } : {}) };
  };
  const citarPosicion = (posicion: PosicionLeida): ActivoCitado => ({
    clave: posicion.isin,
    isin: posicion.isin,
    nombre: posicion.nombre,
    ...(posicion.divisa ? { divisa: posicion.divisa } : {}),
    tipo: tipoDeLaClase(posicion.clase)
  });
  /** La posición cuyo nombre casa con el del concepto, si es una sola. */
  const posicionPorNombre = (nombre: string | undefined): PosicionLeida | undefined => {
    const buscado = normalizarNombre(nombre);
    if (!buscado) return undefined;
    const isines = new Set(posiciones.filter((posicion) => nombresCasan(buscado, normalizarNombre(posicion.nombre))).map((posicion) => posicion.isin));
    return isines.size === 1 ? posicionPorIsin.get([...isines][0]) : undefined;
  };
  /** El tipo de activo cuando las posiciones no lo dicen. Una «SUSCRIPCION RV» o «LIBERADA» del export es de acciones, no de un fondo. */
  const defectoDeLaClase = (clase: ClaseDeMovimiento, operacion?: OperacionLeida): TipoDeActivo | undefined => {
    if (operacion && SUSCRIPCIONES_DE_ACCIONES.includes(operacion.tipo)) return "ACCION";
    return clase === "SUSCRIPCION" || clase === "REEMBOLSO" ? "FONDO" : clase === "COMPRA" || clase === "VENTA" ? "ACCION" : undefined;
  };

  /* ---------------- 1. cada fila del efectivo con su operación */

  const usadas = new Set<OperacionLeida>();
  const operacionDeLaFila = new Map<FilaDeMovimiento, OperacionLeida>();
  const cargoDeLaFila = new Map<FilaDeMovimiento, OperacionLeida>();

  /** `_operation_distance`: días entre la fila y la operación si son la misma; `undefined` si no. */
  const distancia = (fila: FilaDeMovimiento, operacion: OperacionLeida): number | undefined => {
    if (!esClaseConOperacion(fila.clase) || !TIPOS_COMPATIBLES[fila.clase].includes(operacion.tipo)) return undefined;
    const dias = Math.min(Math.abs(diasEntre(operacion.fechaOperacion, fila.fechaOperacion)), Math.abs(diasEntre(operacion.fechaLiquidacion, fila.fechaOperacion)));
    if (dias > DIAS_DE_MARGEN) return undefined;
    const titulos = fila.titulos?.abs();
    const fiables = titulos !== undefined && titulos.gt(0) && !fila.titulosCortados;
    if (operacion.divisa && operacion.divisa !== divisaBase) {
      if (!fiables || titulos.minus(operacion.titulos).abs().gt("0.000001")) return undefined;
      return dias;
    }
    if (operacion.importe.minus(fila.importe.abs()).abs().gt(DIFERENCIA_MAXIMA)) return undefined;
    if (fiables && operacion.titulos.gt(0)) {
      const margen = operacion.titulos.times("0.02");
      if (titulos.minus(operacion.titulos).abs().gt(margen.gt("0.5") ? margen : "0.5") && !cortadosSinMarcar(fila, titulos, operacion.titulos)) return undefined;
    }
    return dias;
  };

  /**
   * Títulos cortados que la lectura no ha podido marcar. El banco corta el concepto a 30 caracteres
   * sobre su texto ORIGINAL, y el lector de HTML junta antes los espacios repetidos: «RED ELECTRICA
   * CORPORACION  @ 2» (30 caracteres con dos espacios; los títulos eran 200) llega con 29 y no se marca
   * como cortado. Con el importe ya casado al céntimo, unos títulos que no casan no vetan el enlace si,
   * escritos como texto, son el principio de los de la operación («2» o «20» de «200», «63.» de
   * «63.123») y el concepto mide al menos 28 caracteres, que es lo que queda de 30 tras juntar espacios.
   */
  const cortadosSinMarcar = (fila: FilaDeMovimiento, titulos: Decimal, deLaOperacion: Decimal): boolean => {
    if (fila.concepto.length < LARGO_DE_UN_CONCEPTO_QUIZA_CORTADO) return false;
    const leidos = aTexto(titulos);
    const completos = aTexto(deLaOperacion);
    return completos.length > leidos.length && completos.startsWith(leidos);
  };

  /**
   * `operation_for_movement`: la operación más cercana en fecha. Si a esa distancia quedan varias, gana la de importe
   * EXACTAMENTE igual al de la fila (dos fondos suscritos el mismo día por 4.999,96 € y 4.999,95 € casan los dos con la
   * tolerancia de 0,011); si no queda una sola, desempata el principio del nombre.
   */
  const operacionPara = (fila: FilaDeMovimiento): OperacionLeida | undefined => {
    const puntuadas = operaciones
      .filter((operacion) => !usadas.has(operacion))
      .map((operacion) => ({ operacion, dias: distancia(fila, operacion) }))
      .filter((item): item is { operacion: OperacionLeida; dias: number } => item.dias !== undefined);
    if (puntuadas.length === 0) return undefined;
    const minima = Math.min(...puntuadas.map((item) => item.dias));
    let cercanas = puntuadas.filter((item) => item.dias === minima).map((item) => item.operacion);
    if (cercanas.length > 1) {
      const pagado = fila.importe.abs();
      const exactas = cercanas.filter((operacion) => operacion.importe.eq(pagado));
      if (exactas.length === 1) return exactas[0];
      if (exactas.length > 1) cercanas = exactas;
    }
    if (cercanas.length > 1) {
      const nombre = normalizarNombre(fila.nombreActivo);
      if (nombre) cercanas = cercanas.filter((operacion) => nombresCasan(nombre, normalizarNombre(operacion.nombre)));
    }
    return cercanas.length === 1 ? cercanas[0] : undefined;
  };

  for (const fila of filas) {
    if (!esClaseConOperacion(fila.clase)) continue;
    const operacion = operacionPara(fila);
    if (operacion) {
      usadas.add(operacion);
      operacionDeLaFila.set(fila, operacion);
    }
  }

  /* ---------------- 2. los cargos de mercado que el efectivo llama «compra» (`_market_charges_as_commissions`) */

  const cargos = operaciones.filter((operacion) => operacion.tipo.includes("CARGO GASTOS") && operacion.importe.gt(0));
  for (const fila of filas) {
    if (fila.clase !== "COMPRA" || operacionDeLaFila.has(fila) || fila.importe.gte(0)) continue;
    const nombre = normalizarNombre(fila.nombreActivo);
    const isinPorNombre = posicionPorNombre(fila.nombreActivo)?.isin;
    const pagado = fila.importe.abs();
    for (const cargo of cargos) {
      if (usadas.has(cargo)) continue;
      const mismoActivo = nombresCasan(nombre, normalizarNombre(cargo.nombre)) || (isinPorNombre !== undefined && isinPorNombre === cargo.isin);
      if (!mismoActivo) continue;
      const dias = Math.min(Math.abs(diasEntre(cargo.fechaOperacion, fila.fechaOperacion)), Math.abs(diasEntre(cargo.fechaLiquidacion, fila.fechaOperacion)));
      if (dias > DIAS_DE_MARGEN_DEL_CARGO) continue;
      /* Al céntimo si el cargo es en la divisa base; en otra divisa, dentro de un orden de magnitud: es lo que separa un
         cargo de cuatro dólares de una compra de verdad. */
      const mismoTamano = !cargo.divisa || cargo.divisa === divisaBase
        ? pagado.minus(cargo.importe).abs().lte(DIFERENCIA_MAXIMA)
        : pagado.div(cargo.importe).gte("0.2") && pagado.div(cargo.importe).lte(5);
      if (!mismoTamano) continue;
      usadas.add(cargo);
      cargoDeLaFila.set(fila, cargo);
      break;
    }
  }

  /* ---------------- 3. en otra divisa, con los títulos cortados: la operación del mismo tipo, fecha y nombre */

  const sinEnlazar = (fila: FilaDeMovimiento) =>
    esClaseConOperacion(fila.clase) && !operacionDeLaFila.has(fila) && !cargoDeLaFila.has(fila) && normalizarNombre(fila.nombreActivo) !== "";
  const candidatasEnOtraDivisa = (fila: FilaDeMovimiento): OperacionLeida[] => {
    const nombre = normalizarNombre(fila.nombreActivo);
    return operaciones.filter((operacion) =>
      !usadas.has(operacion)
      && operacion.divisa !== undefined && operacion.divisa !== divisaBase
      && TIPOS_COMPATIBLES[fila.clase as ClaseConOperacion].includes(operacion.tipo)
      && Math.min(Math.abs(diasEntre(operacion.fechaOperacion, fila.fechaOperacion)), Math.abs(diasEntre(operacion.fechaLiquidacion, fila.fechaOperacion))) <= DIAS_DE_MARGEN
      && nombresCasan(nombre, normalizarNombre(operacion.nombre)));
  };
  const mismasOperaciones = (a: OperacionLeida[], b: OperacionLeida[]) => a.length === b.length && a.every((operacion) => b.includes(operacion));

  for (const fila of filas) {
    if (!sinEnlazar(fila)) continue;
    const candidatas = candidatasEnOtraDivisa(fila);
    if (candidatas.length === 1) {
      usadas.add(candidatas[0]);
      operacionDeLaFila.set(fila, candidatas[0]);
      continue;
    }
    if (candidatas.length < 2) continue;
    /* Varias filas y varias operaciones del mismo activo, tipo y día (dos dividendos de un ADR el mismo día): si hay
       tantas filas sin enlazar, con el signo de su clase, como operaciones candidatas, y todas tienen esas mismas
       candidatas, se emparejan por orden de importe: la fila mayor con la operación mayor. Si los números no coinciden,
       no se enlaza nada. */
    const clase = fila.clase as ClaseConOperacion;
    const grupo = filas.filter((otra) =>
      otra.clase === clase && sinEnlazar(otra) && otra.importe.times(SIGNO_DE_LA_CLASE[clase]).gt(0) && mismasOperaciones(candidatasEnOtraDivisa(otra), candidatas));
    if (!grupo.includes(fila) || grupo.length !== candidatas.length) continue;
    const filasPorImporte = [...grupo].sort((a, b) => b.importe.abs().cmp(a.importe.abs()));
    const operacionesPorImporte = [...candidatas].sort((a, b) => b.importe.cmp(a.importe) || a.orden - b.orden);
    filasPorImporte.forEach((otra, indice) => {
      usadas.add(operacionesPorImporte[indice]);
      operacionDeLaFila.set(otra, operacionesPorImporte[indice]);
    });
  }

  /* ---------------- 3 bis. la identidad por nombre (`resolve_operations_mapping`) */

  /**
   * Para una fila sin operación propia: (a) si las operaciones del export cuyo nombre casa con el de la fila son de un
   * único ISIN, es ese; (b) si no, votan las demás filas del efectivo con el mismo nombre que sí están enlazadas con una
   * operación: si todas apuntan al mismo ISIN, es ese, y si apuntan a varios, no se elige. Devuelve una operación de ese
   * ISIN para citarla (ISIN, nombre y divisa del banco), nunca para tomar de ella títulos ni precio.
   */
  const operacionPorNombre = (fila: FilaDeMovimiento): OperacionLeida | undefined => {
    const nombre = normalizarNombre(fila.nombreActivo);
    if (!nombre) return undefined;
    const delNombre = operaciones.filter((operacion) => nombresCasan(nombre, normalizarNombre(operacion.nombre)));
    if (new Set(delNombre.map((operacion) => operacion.isin)).size === 1) return delNombre[0];
    const votos = new Map<string, OperacionLeida>();
    for (const otra of filas) {
      if (otra === fila || normalizarNombre(otra.nombreActivo) !== nombre) continue;
      const enlazada = operacionDeLaFila.get(otra);
      if (enlazada && !votos.has(enlazada.isin)) votos.set(enlazada.isin, enlazada);
    }
    return votos.size === 1 ? [...votos.values()][0] : undefined;
  };

  /* ---------------- 4. las filas del efectivo */

  const base = (id: string, tipo: string, fecha: Dia, origen: { documento: string; fila: number; textoOriginal: string }): Movimiento => ({
    id,
    tipo,
    fechaOperacion: fecha,
    origen: { via: "importado", documento: origen.documento, fila: origen.fila, textoOriginal: origen.textoOriginal }
  });
  const proponerMovimiento = (movimiento: Movimiento, extra: { activo?: ActivoCitado; destino?: ActivoCitado; avisos?: string[]; revisar?: boolean }, origen: { documento: string; fila: number; textoOriginal: string }, orden: number) => {
    propuestos.push({
      orden,
      propuesto: {
        movimiento,
        ...(extra.activo ? { activo: extra.activo } : {}),
        ...(extra.destino ? { destino: extra.destino } : {}),
        avisos: extra.avisos ?? [],
        requiereRevision: extra.revisar ?? false,
        documento: origen.documento,
        fila: origen.fila,
        textoOriginal: origen.textoOriginal
      }
    });
  };

  /* El saldo con el que empieza el extracto. */
  const extracto = entrada.movimientos;
  if (extracto && filas.length > 0 && !extracto.saldoInicial.eq(0)) {
    const origen = extracto.origenDelSaldoInicial ?? filas[0];
    const fecha = extracto.fechaSaldoInicial ?? filas[0].fechaOperacion;
    const saldo = extracto.saldoInicial;
    const movimiento = base("andbank-mov-0", saldo.gt(0) ? "aportacion" : "retirada", fecha, origen);
    movimiento.importe = aTexto(saldo);
    movimiento.nota = "Saldo inicial del extracto";
    proponerMovimiento(movimiento, {
      revisar: true,
      avisos: [`El extracto empieza con un saldo de ${importeEnTexto(saldo)} €: se ha anotado como saldo inicial. Si tienes los movimientos anteriores, impórtalos también.`]
    }, origen, -1);
  }

  let descartadas = 0;
  filas.forEach((fila, indice) => {
    if (fila.importe.eq(0)) {
      descartadas += 1;
      return;
    }
    const id = `andbank-mov-${indice + 1}`;
    const movimiento = base(id, "otroEfectivo", fila.fechaOperacion, fila);
    if (fila.fechaValor) movimiento.fechaValor = fila.fechaValor;
    movimiento.importe = aTexto(fila.importe);
    const avisosDeLaFila: string[] = [];
    let revisar = false;
    let activo: ActivoCitado | undefined;

    const otro = (aviso: string) => {
      movimiento.tipo = "otroEfectivo";
      proponerMovimiento(movimiento, { revisar: true, avisos: [aviso] }, fila, indice);
    };

    if (fila.clase === "TRANSFERENCIA") {
      movimiento.tipo = fila.importe.gt(0) ? "aportacion" : "retirada";
      proponerMovimiento(movimiento, {}, fila, indice);
      return;
    }
    if (fila.clase === "INTERES") {
      movimiento.tipo = "interes";
      proponerMovimiento(movimiento, {}, fila, indice);
      return;
    }
    /* Un abono del banco que no es de ningún activo (una retrocesión, una penalización a su cargo, una anulación de un
       gasto): con importe positivo, su signo es el de un abono y no hace falta revisarlo. */
    const abonoDelBanco = () => {
      movimiento.tipo = "otroEfectivo";
      proponerMovimiento(movimiento, { avisos: [`Abono del banco: «${fila.tipoTexto}». Se propone como otro abono de efectivo.`] }, fila, indice);
    };
    if (fila.clase === "OTRO" && fila.importe.gt(0) && ABONO_DEL_BANCO.test(fila.tipoTexto.toUpperCase())) {
      abonoDelBanco();
      return;
    }
    if (fila.clase === "APERTURA" || fila.clase === "REPO" || fila.clase === "OTRO") {
      otro(`El banco lo llama «${fila.tipoTexto}», y no se sabe a qué tipo de movimiento corresponde: revísalo antes de importarlo.`);
      return;
    }
    if (fila.clase === "COMISION" && fila.importe.gt(0)) {
      abonoDelBanco();
      return;
    }

    const cargo = cargoDeLaFila.get(fila);
    if (cargo) {
      movimiento.tipo = "comision";
      movimiento.activoId = cargo.isin;
      proponerMovimiento(movimiento, {
        activo: citarOperacion(cargo),
        avisos: ["El extracto lo llama compra, pero el export de operaciones dice que es un cargo de gastos de mercado: se propone como comisión, sin títulos."]
      }, fila, indice);
      return;
    }

    const clase = fila.clase;
    const signo = SIGNO_DE_LA_CLASE[clase];
    if (fila.importe.times(signo).lt(0)) {
      otro(
        `El importe es ${fila.importe.gt(0) ? "positivo" : "negativo"}, y ${NOMBRE_DE_LA_CLASE[clase]} ${signo < 0 ? "resta" : "suma"} efectivo: puede ser una anulación o una corrección del banco. ` +
          "Se propone como otro cargo o abono; revísalo."
      );
      return;
    }

    /* La identidad del activo: la operación, las posiciones o solo el nombre. */
    const operacion = operacionDeLaFila.get(fila);
    if (operacion) {
      activo = citarOperacion(operacion, defectoDeLaClase(clase, operacion));
    } else {
      const posicion = posicionPorNombre(fila.nombreActivo);
      if (posicion) activo = citarPosicion(posicion);
      else {
        const delNombre = operacionPorNombre(fila);
        if (delNombre) activo = citarOperacion(delNombre, defectoDeLaClase(clase, delNombre));
      }
    }
    if (clase === "DIVIDENDO" && esDevolucionDePrima(fila.tipoTexto)) movimiento.nota = "Devolución de prima de emisión";

    if (clase === "COMISION") {
      movimiento.tipo = "comision";
      if (activo) movimiento.activoId = activo.clave;
      proponerMovimiento(movimiento, { activo }, fila, indice);
      return;
    }

    movimiento.tipo = TIPO_DEL_MOVIMIENTO[clase];
    if (!activo) {
      if (fila.nombreActivo) {
        activo = { clave: normalizarNombre(fila.nombreActivo), nombre: fila.nombreActivo, ...(defectoDeLaClase(clase) ? { tipo: defectoDeLaClase(clase) } : {}) };
        avisosDeLaFila.push("El activo solo se conoce por su nombre en el extracto: elige cuál es antes de importar.");
      } else {
        avisosDeLaFila.push("El extracto no dice de qué activo es: elígelo antes de importar.");
      }
      revisar = true;
    }
    if (activo) movimiento.activoId = activo.clave;

    if (clase !== "DIVIDENDO") {
      const titulos = operacion && operacion.titulos.gt(0) ? operacion.titulos : fila.titulos?.abs();
      if (titulos && titulos.gt(0)) {
        movimiento.titulos = aTexto(titulos);
      } else {
        avisosDeLaFila.push("Faltan los títulos: complétalos antes de importar.");
        revisar = true;
      }
      if (!operacion && fila.titulosCortados) {
        avisosDeLaFila.push(AVISO_TITULOS_CORTADOS);
        revisar = true;
      }
      if (operacion?.precio && operacion.precio.gt(0)) {
        movimiento.precio = aTexto(operacion.precio);
        if (operacion.divisa && operacion.divisa !== divisaBase && titulos && titulos.gt(0)) {
          /* Unidades de la divisa del activo por 1 unidad de la base: lo pagado en divisa entre lo pagado en euros. */
          const cambio = redondear(titulos.times(operacion.precio).div(fila.importe.abs()), 6);
          if (cambio.gt(0)) movimiento.cambio = aTexto(cambio);
        }
      }
    }
    proponerMovimiento(movimiento, { activo, avisos: avisosDeLaFila, revisar }, fila, indice);
  });
  if (descartadas > 0) {
    avisos.push(`Se ${descartadas === 1 ? "ha descartado 1 apunte" : `han descartado ${descartadas} apuntes`} de importe cero del extracto de movimientos.`);
  }

  /* ---------------- 5. operaciones con efectivo que no tienen su fila */

  const inicio = extracto ? (extracto.fechaSaldoInicial ?? filas[0]?.fechaOperacion) : undefined;
  const fin = filas.length > 0 ? filas[filas.length - 1].fechaOperacion : undefined;
  const describir = (operacion: OperacionLeida) =>
    `${fechaEnTexto(operacion.fechaOperacion)}, ${operacion.tipo} de ${operacion.nombre} (${operacion.isin}), ${titulosEnTexto(operacion.titulos)} títulos`;

  for (const operacion of operaciones) {
    if (usadas.has(operacion)) continue;
    /* Lo que solo describe un apunte de efectivo no se propone desde el export: lo trata el paso 8. */
    const clase = esSoloEfectivo(operacion.tipo) ? undefined : claseDeLaOperacion(operacion.tipo);
    if (!clase) continue;
    usadas.add(operacion);
    const conExtracto = filas.length > 0;
    if (conExtracto && inicio && fin && (operacion.fechaOperacion < inicio || operacion.fechaOperacion > fin)) {
      avisos.push(`Operación ${operacion.fechaOperacion < inicio ? "anterior" : "posterior"} al extracto de efectivo, no importada: ${describir(operacion)}.`);
      continue;
    }
    if (operacion.importe.eq(0)) {
      avisos.push(`Operación sin importe, no importada: ${describir(operacion)}. Si cambia la cartera, dala de alta a mano.`);
      continue;
    }
    const movimiento = base(`andbank-op-${operacion.orden}`, TIPO_DEL_MOVIMIENTO[clase], operacion.fechaOperacion, operacion);
    if (operacion.fechaLiquidacion !== operacion.fechaOperacion) movimiento.fechaValor = operacion.fechaLiquidacion;
    movimiento.activoId = operacion.isin;
    const avisosDeLaOperacion: string[] = [];
    let revisar = conExtracto;
    if (conExtracto) avisosDeLaOperacion.push(AVISO_SIN_APUNTE);
    if (clase !== "DIVIDENDO") {
      if (operacion.titulos.gt(0)) movimiento.titulos = aTexto(operacion.titulos);
      if (operacion.precio && operacion.precio.gt(0)) movimiento.precio = aTexto(operacion.precio);
    }
    if (!operacion.divisa || operacion.divisa === divisaBase) {
      movimiento.importe = aTexto(operacion.importe.times(SIGNO_DE_LA_CLASE[clase]));
    } else {
      avisosDeLaOperacion.push(AVISO_FALTA_IMPORTE);
      revisar = true;
    }
    proponerMovimiento(movimiento, { activo: citarOperacion(operacion, defectoDeLaClase(clase, operacion)), avisos: avisosDeLaOperacion, revisar }, operacion, ORDEN_DE_OPERACIONES + operacion.orden);
  }

  /* ---------------- 6. traspasos entre fondos */

  const salidas = operaciones.filter((operacion) => operacion.traspaso === "SALE").sort(porFecha);
  const entradas = operaciones.filter((operacion) => operacion.traspaso === "ENTRA").sort(porFecha);
  const enPareja = new Set<OperacionLeida>();
  const parejas: Array<{ salidas: OperacionLeida[]; entradas: OperacionLeida[] }> = [];
  const dentroDelPlazo = (salida: OperacionLeida, llegada: OperacionLeida) => {
    const dias = diasEntre(salida.fechaOperacion, llegada.fechaOperacion);
    return dias >= 0 && dias <= DIAS_DE_UN_TRASPASO;
  };

  /* Uno a uno: por importe, y a igualdad, la entrada más cercana en fecha. */
  for (const salida of salidas) {
    const tolerancia = toleranciaDeTraspaso(salida.importe);
    const candidatas = entradas
      .filter((llegada) => !enPareja.has(llegada) && llegada.divisa === salida.divisa && dentroDelPlazo(salida, llegada) && llegada.importe.minus(salida.importe).abs().lte(tolerancia))
      .sort((a, b) =>
        diasEntre(salida.fechaOperacion, a.fechaOperacion) - diasEntre(salida.fechaOperacion, b.fechaOperacion)
        || a.importe.minus(salida.importe).abs().cmp(b.importe.minus(salida.importe).abs())
        || a.orden - b.orden);
    if (candidatas.length > 0) {
      enPareja.add(salida);
      enPareja.add(candidatas[0]);
      parejas.push({ salidas: [salida], entradas: [candidatas[0]] });
    }
  }
  /* Una salida repartida en varias entradas del mismo día. */
  for (const salida of salidas) {
    if (enPareja.has(salida)) continue;
    const libres = entradas.filter((llegada) => !enPareja.has(llegada) && llegada.divisa === salida.divisa && dentroDelPlazo(salida, llegada));
    const reparto = repartoDelMismoDia(salida.importe, libres, (llegada) => diasEntre(salida.fechaOperacion, llegada.fechaOperacion));
    if (reparto) {
      enPareja.add(salida);
      for (const llegada of reparto) enPareja.add(llegada);
      parejas.push({ salidas: [salida], entradas: reparto });
    }
  }
  /* Varias salidas del mismo día que entran juntas en un fondo. */
  for (const llegada of entradas) {
    if (enPareja.has(llegada)) continue;
    const libres = salidas.filter((salida) => !enPareja.has(salida) && salida.divisa === llegada.divisa && dentroDelPlazo(salida, llegada));
    const reparto = repartoDelMismoDia(llegada.importe, libres, (salida) => diasEntre(salida.fechaOperacion, llegada.fechaOperacion));
    if (reparto) {
      enPareja.add(llegada);
      for (const salida of reparto) enPareja.add(salida);
      parejas.push({ salidas: reparto, entradas: [llegada] });
    }
  }
  /* Varios a varios, por oleadas (`_transfer_legs_close`): ver la cabecera. */
  const partesDeOleadas = repartoPorOleadas(
    salidas.filter((salida) => !enPareja.has(salida)),
    entradas.filter((llegada) => !enPareja.has(llegada))
  );
  for (const parte of partesDeOleadas) {
    enPareja.add(parte.salida);
    enPareja.add(parte.llegada);
  }

  const textoDeVarias = (lista: OperacionLeida[]) => lista.map((operacion) => operacion.textoOriginal).join(" || ");
  const proponerTraspaso = (id: string, salida: OperacionLeida, llegada: OperacionLeida, titulos: Decimal, titulosDestino: Decimal, valor: Decimal, otras: OperacionLeida[]) => {
    const origen = { documento: salida.documento, fila: salida.fila, textoOriginal: textoDeVarias([salida, ...otras]) };
    const movimiento = base(id, "traspaso", salida.fechaOperacion, origen);
    movimiento.activoId = salida.isin;
    movimiento.titulos = aTexto(titulos);
    if (salida.precio) movimiento.precio = aTexto(salida.precio);
    movimiento.valor = aTexto(valor);
    movimiento.destino = {
      activoId: llegada.isin,
      titulos: aTexto(titulosDestino),
      ...(llegada.precio ? { precio: aTexto(llegada.precio) } : {}),
      ...(llegada.fechaOperacion > salida.fechaOperacion ? { fecha: llegada.fechaOperacion } : {})
    };
    if (salida.divisa && salida.divisa !== divisaBase) movimiento.divisa = salida.divisa;
    const mismo = salida.isin === llegada.isin;
    proponerMovimiento(movimiento, {
      activo: citarOperacion(salida, "FONDO"),
      destino: citarOperacion(llegada, "FONDO"),
      revisar: mismo,
      avisos: mismo ? ["El fondo de origen y el de destino tienen el mismo ISIN: revisa el traspaso antes de importarlo."] : []
    }, origen, ORDEN_DE_OPERACIONES + salida.orden);
  };

  for (const pareja of parejas) {
    if (pareja.salidas.length === 1 && pareja.entradas.length === 1) {
      const [salida] = pareja.salidas;
      const [llegada] = pareja.entradas;
      proponerTraspaso(`andbank-op-${salida.orden}`, salida, llegada, salida.titulos, llegada.titulos, salida.importe, [llegada]);
    } else if (pareja.salidas.length === 1) {
      /* Uno a varios: los títulos del origen se reparten en proporción al importe de cada entrada; el último se lleva el resto. */
      const [salida] = pareja.salidas;
      const total = pareja.entradas.reduce((suma, llegada) => suma.plus(llegada.importe), CERO);
      const precision = Math.max(decimalesDe(salida.titulos), 4);
      let repartidos = CERO;
      pareja.entradas.forEach((llegada, indice) => {
        const ultimo = indice === pareja.entradas.length - 1;
        const parte = ultimo ? salida.titulos.minus(repartidos) : redondear(salida.titulos.times(llegada.importe).div(total), precision);
        repartidos = repartidos.plus(parte);
        proponerTraspaso(`andbank-op-${salida.orden}-${indice + 1}`, salida, llegada, parte, llegada.titulos, llegada.importe, [llegada]);
      });
    } else {
      /* Varios a uno: los títulos del destino se reparten en proporción al importe de cada salida. */
      const [llegada] = pareja.entradas;
      const total = pareja.salidas.reduce((suma, salida) => suma.plus(salida.importe), CERO);
      const precision = Math.max(decimalesDe(llegada.titulos), 4);
      let repartidos = CERO;
      pareja.salidas.forEach((salida, indice) => {
        const ultimo = indice === pareja.salidas.length - 1;
        const parte = ultimo ? llegada.titulos.minus(repartidos) : redondear(llegada.titulos.times(salida.importe).div(total), precision);
        repartidos = repartidos.plus(parte);
        proponerTraspaso(`andbank-op-${salida.orden}`, salida, llegada, salida.titulos, parte, salida.importe, [llegada]);
      });
    }
  }
  /* Cada (salida, entrada) aparece una sola vez en una oleada: el identificador es único. */
  for (const parte of partesDeOleadas) {
    proponerTraspaso(`andbank-op-${parte.salida.orden}-a-${parte.llegada.orden}`, parte.salida, parte.llegada, parte.titulos, parte.titulosDestino, parte.valor, [parte.llegada]);
  }

  for (const salida of salidas) {
    if (enPareja.has(salida)) continue;
    const movimiento = base(`andbank-op-${salida.orden}`, "salidaDeTitulos", salida.fechaOperacion, salida);
    movimiento.activoId = salida.isin;
    movimiento.titulos = aTexto(salida.titulos);
    proponerMovimiento(movimiento, {
      activo: citarOperacion(salida, "FONDO"),
      revisar: true,
      avisos: ["Traspaso de salida sin su entrada en esta cuenta: si el fondo se ha traspasado a otra entidad, es una salida de títulos. Compruébalo."]
    }, salida, ORDEN_DE_OPERACIONES + salida.orden);
  }
  for (const llegada of entradas) {
    if (enPareja.has(llegada)) continue;
    const movimiento = base(`andbank-op-${llegada.orden}`, "entradaDeTitulos", llegada.fechaOperacion, llegada);
    movimiento.activoId = llegada.isin;
    movimiento.titulos = aTexto(llegada.titulos);
    if (llegada.precio) movimiento.precio = aTexto(llegada.precio);
    movimiento.valor = aTexto(llegada.importe);
    if (llegada.divisa && llegada.divisa !== divisaBase) movimiento.divisa = llegada.divisa;
    proponerMovimiento(movimiento, {
      activo: citarOperacion(llegada, "FONDO"),
      revisar: true,
      avisos: [
        "Traspaso de entrada sin su salida en esta cuenta: si el fondo viene de otra entidad, es una entrada de títulos. " +
          "Su coste es el valor del traspaso; si conoces el coste de origen, cámbialo."
      ]
    }, llegada, ORDEN_DE_OPERACIONES + llegada.orden);
  }

  /* ---------------- 7. canjes y equiparaciones */

  const enCanje = new Set<OperacionLeida>();
  for (const [tipoBaja, tipoAlta] of [["BAJA POR CANJE", "ALTA POR CANJE"], ["EQUIPARACION-BAJA", "EQUIPARACION-ALTA"]] as const) {
    for (const baja of operaciones.filter((operacion) => operacion.tipo === tipoBaja)) {
      let altas = operaciones.filter((operacion) => operacion.tipo === tipoAlta && !enCanje.has(operacion) && operacion.fechaOperacion === baja.fechaOperacion && operacion.isin !== baja.isin);
      if (altas.length > 1) altas = altas.filter((alta) => alta.titulos.eq(baja.titulos));
      if (altas.length !== 1) continue;
      const [alta] = altas;
      enCanje.add(baja);
      enCanje.add(alta);
      const origen = { documento: baja.documento, fila: baja.fila, textoOriginal: textoDeVarias([baja, alta]) };
      const movimiento = base(`andbank-op-${baja.orden}`, "canje", baja.fechaOperacion, origen);
      movimiento.activoId = baja.isin;
      if (baja.titulos.gt(0)) movimiento.titulos = aTexto(baja.titulos);
      movimiento.destino = { activoId: alta.isin, titulos: aTexto(alta.titulos) };
      const sinTitulos = alta.titulos.lte(0);
      proponerMovimiento(movimiento, {
        activo: citarOperacion(baja),
        destino: citarOperacion(alta),
        revisar: sinTitulos,
        avisos: sinTitulos ? ["El banco no dice cuántos títulos se reciben: complétalo antes de importar."] : []
      }, origen, ORDEN_DE_OPERACIONES + baja.orden);
    }
  }

  /* ---------------- 7 bis. derechos de suscripción */

  /* Se asignan sin coste («ALTA DCHOS. SUSCRIP.»: títulos gratis, no una aportación) y se extinguen al ejercerlos
     («EJERCICIO DERECHOS»: una baja sin efectivo, no una retirada; su valor pasa a las acciones nuevas). Los sobrantes se venden
     con una venta normal, que tiene su fila en el efectivo: sin el alta, esa venta dejaría un descubierto de títulos. Si
     al final quedan derechos sin salir, lo dirá la conciliación con el extracto de posiciones. */
  const enDerechos = new Set<OperacionLeida>();
  for (const operacion of operaciones) {
    const alta = operacion.tipo === ALTA_DE_DERECHOS;
    if ((!alta && operacion.tipo !== EJERCICIO_DE_DERECHOS) || usadas.has(operacion) || operacion.titulos.lte(0)) continue;
    enDerechos.add(operacion);
    const movimiento = base(`andbank-op-${operacion.orden}`, alta ? "dividendoEnAcciones" : "extincionDeTitulos", operacion.fechaOperacion, operacion);
    movimiento.activoId = operacion.isin;
    movimiento.titulos = aTexto(operacion.titulos);
    movimiento.nota = alta ? "Derechos de suscripción asignados" : "Derechos ejercidos";
    proponerMovimiento(movimiento, { activo: citarOperacion(operacion, "ACCION") }, operacion, ORDEN_DE_OPERACIONES + operacion.orden);
  }

  /* ---------------- 8. lo demás no se convierte: se lista para darlo de alta a mano */

  /* Lo que solo describe un apunte de efectivo que el extracto de la cuenta ya trae no se manda dar de alta: se duplicaría. */
  const yaEnElEfectivo: string[] = [];
  for (const operacion of operaciones) {
    if (usadas.has(operacion) || operacion.traspaso || enCanje.has(operacion) || enDerechos.has(operacion)) continue;
    if (esSoloEfectivo(operacion.tipo) && filas.length > 0 && inicio && fin && operacion.fechaOperacion >= inicio && operacion.fechaOperacion <= fin) {
      yaEnElEfectivo.push(operacion.tipo);
      continue;
    }
    avisos.push(`Operación no importada: ${describir(operacion)}. Si cambia la cartera, dala de alta a mano.`);
  }
  if (yaEnElEfectivo.length > 0) {
    const una = yaEnElEfectivo.length === 1;
    avisos.push(
      `${una ? "Una operación" : `${yaEnElEfectivo.length} operaciones`} del export (${[...new Set(yaEnElEfectivo)].join(", ")}) solo ${una ? "describe" : "describen"} ` +
        `un apunte de efectivo que ya está en el extracto de la cuenta: no se ${una ? "importa" : "importan"} aparte para no duplicarlo.`
    );
  }

  /* ---------------- 9. lo que declaran los extractos */

  const extractos: ExtractoPropuesto[] = [];
  if (entrada.posiciones) {
    const { fecha, documento } = entrada.posiciones;
    if (!fecha) {
      avisos.push(`El extracto de posiciones «${documento}» no tiene ninguna fecha de cotización válida: no se ha guardado lo que declara.`);
    } else {
      extractos.push({
        fecha,
        documento,
        posiciones: posiciones
          .filter((posicion) => posicion.titulos !== undefined)
          .map((posicion) => ({
            activo: citarPosicion(posicion),
            titulos: aTexto(posicion.titulos!),
            valor: aTexto(posicion.valor),
            /* GES-10: cada precio, con la fecha de su cotización; la del extracto es la mayor de todas. */
            ...(posicion.fechaDeCotizacion ? { fecha: posicion.fechaDeCotizacion } : {})
          })),
        efectivo: []
      });
    }
    avisos.push(...entrada.posiciones.avisos);
  }
  if (filas.length > 0) {
    const ultima = filas[filas.length - 1];
    extractos.push({ fecha: ultima.fechaOperacion, documento: ultima.documento, posiciones: [], efectivo: [{ divisa: divisaBase, saldo: aTexto(ultima.saldo) }] });
  }

  const movimientos = propuestos
    .sort((a, b) => (a.propuesto.movimiento.fechaOperacion < b.propuesto.movimiento.fechaOperacion ? -1 : a.propuesto.movimiento.fechaOperacion > b.propuesto.movimiento.fechaOperacion ? 1 : a.orden - b.orden))
    .map((item) => item.propuesto);
  return { movimientos, extractos, avisos };
}

/** Una parte de una oleada de traspasos: lo que pasa de una salida a una entrada. */
interface ParteDeOleada {
  salida: OperacionLeida;
  llegada: OperacionLeida;
  titulos: Decimal;
  titulosDestino: Decimal;
  valor: Decimal;
}

/**
 * Las partes de las oleadas que cierran, entre las patas de traspaso que siguen sueltas. Una oleada es
 * el conjunto de patas de la misma divisa enlazadas porque una entrada cae entre 0 y
 * `DIAS_DE_UN_TRASPASO` días después de una salida. Las que no cierran no dan ninguna parte.
 */
function repartoPorOleadas(salidas: OperacionLeida[], entradas: OperacionLeida[]): ParteDeOleada[] {
  const enlazan = (salida: OperacionLeida, llegada: OperacionLeida) => {
    const dias = diasEntre(salida.fechaOperacion, llegada.fechaOperacion);
    return salida.divisa === llegada.divisa && dias >= 0 && dias <= DIAS_DE_UN_TRASPASO;
  };
  const sueltas = new Set<OperacionLeida>([...salidas, ...entradas]);
  const partes: ParteDeOleada[] = [];
  for (const semilla of salidas) {
    if (!sueltas.has(semilla)) continue;
    sueltas.delete(semilla);
    const oleada = { salidas: [] as OperacionLeida[], entradas: [] as OperacionLeida[] };
    const pendientes = [semilla];
    while (pendientes.length > 0) {
      const pata = pendientes.pop()!;
      const sale = pata.traspaso === "SALE";
      (sale ? oleada.salidas : oleada.entradas).push(pata);
      for (const otra of [...sueltas]) {
        if (otra.traspaso === pata.traspaso) continue;
        if (sale ? enlazan(pata, otra) : enlazan(otra, pata)) {
          sueltas.delete(otra);
          pendientes.push(otra);
        }
      }
    }
    if (oleada.entradas.length === 0) continue;
    partes.push(...(repartoDeUnaOleada(oleada.salidas.sort(porFecha), oleada.entradas.sort(porFecha)) ?? []));
  }
  return partes;
}

/**
 * El dinero de una oleada, repartido en orden de fecha: cada salida cubre las entradas más antiguas que
 * queden, `min(lo que queda de la salida, lo que queda de la entrada)` cada vez. No cierra (y no da nada)
 * si las sumas difieren más que la tolerancia de un traspaso sobre el total, si una entrada tendría que
 * llegar antes que su salida o más de `DIAS_DE_UN_TRASPASO` días después, si una pata se queda sin
 * parte, o si a una parte le tocarían cero títulos. Los títulos de cada parte son los de su pata en
 * proporción al importe, y la última parte de cada pata se lleva el resto, para que sumen los suyos.
 */
function repartoDeUnaOleada(salidas: OperacionLeida[], entradas: OperacionLeida[]): ParteDeOleada[] | undefined {
  const sumar = (lista: OperacionLeida[]) => lista.reduce((suma, operacion) => suma.plus(operacion.importe), CERO);
  const totalQueSale = sumar(salidas);
  if (totalQueSale.minus(sumar(entradas)).abs().gt(toleranciaDeTraspaso(totalQueSale))) return undefined;

  const quedaDeLaSalida = salidas.map((salida) => salida.importe);
  const quedaDeLaEntrada = entradas.map((llegada) => llegada.importe);
  const tramos: Array<{ i: number; j: number; valor: Decimal }> = [];
  let i = 0;
  let j = 0;
  while (i < salidas.length && j < entradas.length) {
    const dias = diasEntre(salidas[i].fechaOperacion, entradas[j].fechaOperacion);
    if (dias < 0 || dias > DIAS_DE_UN_TRASPASO) return undefined;
    const valor = quedaDeLaSalida[i].lt(quedaDeLaEntrada[j]) ? quedaDeLaSalida[i] : quedaDeLaEntrada[j];
    tramos.push({ i, j, valor });
    quedaDeLaSalida[i] = quedaDeLaSalida[i].minus(valor);
    quedaDeLaEntrada[j] = quedaDeLaEntrada[j].minus(valor);
    if (quedaDeLaSalida[i].lte(0)) i += 1;
    if (quedaDeLaEntrada[j].lte(0)) j += 1;
  }
  /* Lo que sobra en el último lado cabe en la tolerancia, pero ninguna pata puede quedarse fuera. */
  if (salidas.some((_, indice) => !tramos.some((tramo) => tramo.i === indice))) return undefined;
  if (entradas.some((_, indice) => !tramos.some((tramo) => tramo.j === indice))) return undefined;

  /* Los títulos de una pata repartidos entre sus tramos: en proporción al valor, y el último con el resto. */
  const repartir = (pata: OperacionLeida, suyos: number[]): Map<number, Decimal> => {
    const precision = Math.max(decimalesDe(pata.titulos), 4);
    const reparto = new Map<number, Decimal>();
    let repartidos = CERO;
    suyos.forEach((indice, posicion) => {
      const parte = posicion === suyos.length - 1
        ? pata.titulos.minus(repartidos)
        : redondear(pata.titulos.times(tramos[indice].valor).div(pata.importe), precision);
      repartidos = repartidos.plus(parte);
      reparto.set(indice, parte);
    });
    return reparto;
  };
  const titulosDeOrigen = new Map<number, Decimal>();
  const titulosDeDestino = new Map<number, Decimal>();
  salidas.forEach((salida, indice) => {
    for (const [tramo, titulos] of repartir(salida, tramos.flatMap((t, k) => (t.i === indice ? [k] : [])))) titulosDeOrigen.set(tramo, titulos);
  });
  entradas.forEach((llegada, indice) => {
    for (const [tramo, titulos] of repartir(llegada, tramos.flatMap((t, k) => (t.j === indice ? [k] : [])))) titulosDeDestino.set(tramo, titulos);
  });
  const partes = tramos.map((tramo, k) => ({
    salida: salidas[tramo.i],
    llegada: entradas[tramo.j],
    titulos: titulosDeOrigen.get(k)!,
    titulosDestino: titulosDeDestino.get(k)!,
    valor: tramo.valor
  }));
  return partes.every((parte) => parte.titulos.gt(0) && parte.titulosDestino.gt(0)) ? partes : undefined;
}

function porFecha(a: OperacionLeida, b: OperacionLeida): number {
  return a.fechaOperacion < b.fechaOperacion ? -1 : a.fechaOperacion > b.fechaOperacion ? 1 : a.orden - b.orden;
}

/** Todas las combinaciones de `cuantas` posiciones de `0..total-1`. */
function* combinaciones(total: number, cuantas: number, desde = 0, elegidas: number[] = []): Generator<number[]> {
  if (elegidas.length === cuantas) {
    yield [...elegidas];
    return;
  }
  for (let i = desde; i <= total - (cuantas - elegidas.length); i += 1) {
    elegidas.push(i);
    yield* combinaciones(total, cuantas, i + 1, elegidas);
    elegidas.pop();
  }
}

/**
 * Dos o más operaciones de un mismo día cuya suma es `importe`, con la tolerancia de un
 * traspaso. Se prueban los días de más cercano a más lejano (`dias` da la distancia) y,
 * dentro de un día, la combinación que más se acerca al importe.
 */
function repartoDelMismoDia(importe: Decimal, libres: OperacionLeida[], dias: (operacion: OperacionLeida) => number): OperacionLeida[] | undefined {
  const tolerancia = toleranciaDeTraspaso(importe);
  const porDia = new Map<Dia, OperacionLeida[]>();
  for (const operacion of libres) porDia.set(operacion.fechaOperacion, [...(porDia.get(operacion.fechaOperacion) ?? []), operacion]);
  const diasOrdenados = [...porDia.keys()].sort((a, b) => dias(porDia.get(a)![0]) - dias(porDia.get(b)![0]));
  for (const dia of diasOrdenados) {
    const lista = porDia.get(dia)!.slice(0, MAXIMO_DE_CANDIDATAS);
    let mejor: { diferencia: Decimal; partes: OperacionLeida[] } | undefined;
    for (let cuantas = 2; cuantas <= Math.min(MAXIMO_DE_PARTES, lista.length); cuantas += 1) {
      for (const elegidas of combinaciones(lista.length, cuantas)) {
        const partes = elegidas.map((indice) => lista[indice]);
        const diferencia = partes.reduce((suma, parte) => suma.plus(parte.importe), CERO).minus(importe).abs();
        if (diferencia.lte(tolerancia) && (!mejor || diferencia.lt(mejor.diferencia))) mejor = { diferencia, partes };
      }
    }
    if (mejor) return mejor.partes;
  }
  return undefined;
}
