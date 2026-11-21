/**
 * Lo que se escribe en la pantalla de Jubilación, y cómo llega al motor.
 *
 * La pantalla abre vacía: una cifra que se enseña delante de un cliente no puede ser la de un ejemplo sin rótulo
 * (la misma regla del Comparador patrimonial, del 04-11-2026). El ejemplo se carga a petición y se dice mientras
 * quede algo de él.
 *
 * **Lo que no se ha escrito no es un cero.** Aquí un importe sin escribir es `null`; el motor lo recibe como
 * cero —lo que el cliente no tiene no cuenta— salvo en tres casos, que no calculan o se avisan:
 *
 * - sin la edad no hay nada que proyectar, y no se toma la del caso por defecto del motor;
 * - sin la edad de jubilación de quien aún no se ha jubilado, tampoco;
 * - sin el coste de adquisición de unos fondos, acciones o seguros que sí tienen valor, se calcula con el coste
 *   igual al valor de hoy y **se avisa**: la plusvalía ya acumulada no cuenta, y el IRPF de las retiradas sale
 *   por lo bajo.
 *
 * Todo vive en memoria (`sessionCaches`), como lo demás que puede ser de un cliente: nunca en el almacenamiento
 * del navegador.
 */
import type { InstrumentType } from "../../types/bdbAssets";
import * as F from "./fiscal";
import { DEFECTO, type EntradaDeJubilacion, type Estrategia, type FormaDeCobro, type RegimenDelCapital, type TipoDeRenta } from "./motor";
import type { Sexo } from "./supervivencia";

export interface DatosDeJubilacion {
  territorio: string | null;
  ccaa: string;
  edad: number | null;
  /** Solo elige la tabla de mortalidad con la que se dice cuántos llegan a la edad del plan: no entra en el cálculo. */
  sexo: Sexo | null;
  /** Ya está jubilado, o se jubila ya: la edad de jubilación es la de hoy. */
  jubilado: boolean;
  edadJubilacion: number | null;
  /** Por paga, de 14 al año, en euros de hoy. */
  pension: number | null;
  edadFin: number;
  estrategia: Estrategia;
  liquidez: number | null;
  depositos: number | null;
  fondos: number | null;
  fondosCoste: number | null;
  acciones: number | null;
  accionesCoste: number | null;
  seguros: number | null;
  segurosCoste: number | null;
  ahorroAnual: number | null;
  tieneEpsv: boolean;
  epsvPre: number | null;
  epsvPreRent: number | null;
  epsvPost: number | null;
  epsvPostRent: number | null;
  epsvDesglose: "certificado" | "estimacion";
  antiguedadConocida: boolean;
  antiguedad: number;
  epsvCobro: FormaDeCobro;
  epsvPctCapital: number;
  epsvRenta: TipoDeRenta;
  epsvAniosRenta: number;
  contingencia: string;
  primerCobro: boolean;
  dosAnios: boolean;
  regimen: RegimenDelCapital;
  /** Hipótesis del asesor, en puntos. */
  rentabilidad: number;
  inflacion: number;
  otrasDeducciones: number | null;
  estres: boolean;
  /** De qué ejemplo salen los datos, si se cargó uno. */
  ejemplo: "inicial" | "dfb" | null;
}

/** Los campos de la previsión social, que cambian de significado con el modelo fiscal. */
const PREVISION_VACIA = {
  tieneEpsv: false,
  epsvPre: null,
  epsvPreRent: null,
  epsvPost: null,
  epsvPostRent: null,
  epsvDesglose: "certificado",
  antiguedadConocida: true,
  antiguedad: DEFECTO.antiguedad,
  epsvCobro: "renta",
  epsvPctCapital: DEFECTO.epsvPctCapital,
  epsvRenta: "flexible",
  epsvAniosRenta: DEFECTO.epsvAniosRenta,
  contingencia: "jubilacion",
  primerCobro: true,
  dosAnios: true,
  regimen: "auto"
} as const satisfies Partial<DatosDeJubilacion>;

/**
 * Cómo abre la pantalla. La residencia fiscal sí lleva valor: es la de la casa, está a la vista con su norma y
 * se cambia en un clic. Las hipótesis también: son del asesor, no del cliente.
 */
export function datosVacios(): DatosDeJubilacion {
  return {
    territorio: F.TERRITORIO_DEFECTO,
    ccaa: F.CCAA_DEFECTO,
    edad: null,
    sexo: null,
    jubilado: true,
    edadJubilacion: null,
    pension: null,
    edadFin: DEFECTO.edadFin,
    estrategia: "consumir",
    liquidez: null,
    depositos: null,
    fondos: null,
    fondosCoste: null,
    acciones: null,
    accionesCoste: null,
    seguros: null,
    segurosCoste: null,
    ahorroAnual: null,
    ...PREVISION_VACIA,
    rentabilidad: DEFECTO.rentabilidad,
    inflacion: DEFECTO.inflacion,
    otrasDeducciones: null,
    estres: true,
    ejemplo: null
  };
}

/**
 * El ejemplo: el caso con el que el motor fija sus cifras de regresión (65 años, 2.000 € por paga, 200.000 € de
 * ahorros, 3 % e IPC del 2 %). Cifras inventadas para enseñar la pantalla, y por eso se rotulan.
 */
export function datosDeEjemplo(conservar: Pick<DatosDeJubilacion, "territorio" | "ccaa">): DatosDeJubilacion {
  return {
    ...datosVacios(),
    ...conservar,
    edad: DEFECTO.edad,
    jubilado: true,
    pension: DEFECTO.pension,
    liquidez: DEFECTO.liquidez,
    fondos: DEFECTO.fondos,
    fondosCoste: DEFECTO.fondosCoste,
    acciones: DEFECTO.acciones,
    accionesCoste: DEFECTO.accionesCoste,
    ejemplo: "inicial"
  };
}

/**
 * El caso práctico de EPSV que publica la Hacienda Foral de Bizkaia para 2026: 100.000 € de derechos cobrados de
 * una vez. Solo existe en Bizkaia, y se pone sobre lo que haya escrito del cliente.
 */
export function conElCasoDeLaDfb(datos: DatosDeJubilacion): DatosDeJubilacion {
  return {
    ...datos,
    territorio: "bizkaia",
    ...PREVISION_VACIA,
    tieneEpsv: true,
    epsvPre: 89000,
    epsvPreRent: 27000,
    epsvPost: 11000,
    epsvPostRent: 3000,
    epsvCobro: "capital",
    ejemplo: "dfb"
  };
}

/** Si en pantalla queda algo del ejemplo cargado. Mientras quede, cada documento que salga lo dice. */
export function quedaAlgoDelEjemplo(datos: DatosDeJubilacion): boolean {
  if (datos.ejemplo === "dfb") return datos.tieneEpsv && (datos.epsvPre === 89000 || datos.epsvPost === 11000);
  if (datos.ejemplo === "inicial") {
    return datos.pension === DEFECTO.pension || datos.liquidez === DEFECTO.liquidez || datos.fondos === DEFECTO.fondos || datos.acciones === DEFECTO.acciones;
  }
  return false;
}

const IMPORTES_DEL_CLIENTE = ["pension", "liquidez", "depositos", "fondos", "fondosCoste", "acciones", "accionesCoste", "seguros", "segurosCoste", "ahorroAnual", "epsvPre", "epsvPreRent", "epsvPost", "epsvPostRent"] as const;

/** Si no se ha escrito nada del cliente todavía. Es cuando se ofrece el ejemplo. */
export function sinDatosDelCliente(datos: DatosDeJubilacion): boolean {
  return datos.edad === null && IMPORTES_DEL_CLIENTE.every((campo) => datos[campo] === null);
}

const modeloDe = (territorio: string | null, ccaa: string | null): F.Prevision["modelo"] | null => F.configuracion(territorio, ccaa)?.parametros.prevision.modelo ?? null;

/**
 * Cambio de residencia fiscal. Si cambia el modelo de previsión —EPSV frente a plan de pensiones— o había un caso
 * práctico cargado, la previsión vuelve a vacía: sus campos no significan lo mismo en una normativa que en otra.
 */
export function cambiarTerritorio(datos: DatosDeJubilacion, territorio: string, ccaa?: string): DatosDeJubilacion {
  const siguiente: DatosDeJubilacion = { ...datos, territorio, ccaa: territorio === "estatal" ? ccaa ?? datos.ccaa ?? F.CCAA_DEFECTO : datos.ccaa };
  if (datos.ejemplo === "dfb" || modeloDe(datos.territorio, datos.ccaa) !== modeloDe(territorio, siguiente.ccaa)) {
    return { ...siguiente, ...PREVISION_VACIA, ejemplo: datos.ejemplo === "dfb" ? null : datos.ejemplo };
  }
  return siguiente;
}

const ACTIVOS_CON_COSTE = [
  { valor: "fondos", coste: "fondosCoste", nombre: "los fondos de inversión" },
  { valor: "acciones", coste: "accionesCoste", nombre: "las acciones y ETF" },
  { valor: "seguros", coste: "segurosCoste", nombre: "los seguros de ahorro" }
] as const;

export interface EntradaDelMotor {
  /** `null` cuando falta algo sin lo que no se puede proyectar. */
  entrada: EntradaDeJubilacion | null;
  /** Qué falta, en palabras de pantalla. */
  falta: string | null;
  /** Lo que se ha supuesto para poder calcular, y cambia la cifra. */
  supuestos: string[];
}

/** De lo escrito a lo que el motor recibe, diciendo lo que falta y lo que se ha supuesto. */
export function entradaDelMotor(datos: DatosDeJubilacion): EntradaDelMotor {
  if (datos.edad === null) return { entrada: null, falta: "Falta la edad del cliente.", supuestos: [] };
  if (!datos.jubilado && datos.edadJubilacion === null) return { entrada: null, falta: "Falta la edad a la que se jubilará el cliente.", supuestos: [] };
  const cero = (valor: number | null): number => valor ?? 0;
  /* Sin pensión, sin ahorros y sin previsión el motor daría una fila de ceros, y un cero creíble no es un resultado. */
  const prevision = datos.tieneEpsv ? cero(datos.epsvPre) + cero(datos.epsvPost) : 0;
  if (cero(datos.pension) + totalDeAhorros(datos) + prevision <= 0) {
    return { entrada: null, falta: "Falta la pensión, los ahorros o la previsión social del cliente.", supuestos: [] };
  }
  const sinCoste =ACTIVOS_CON_COSTE.filter(({ valor, coste }) => cero(datos[valor]) > 0 && datos[coste] === null);
  const supuestos = sinCoste.length
    ? [
        `Falta el coste de adquisición de ${sinCoste.map((activo) => activo.nombre).join(", ")}: se calcula con el coste igual al valor de hoy. La plusvalía ya acumulada no cuenta, y el IRPF de las retiradas sale por lo bajo.`
      ]
    : [];
  const costeDe = (valor: "fondos" | "acciones" | "seguros", coste: "fondosCoste" | "accionesCoste" | "segurosCoste"): number => datos[coste] ?? cero(datos[valor]);
  return {
    falta: null,
    supuestos,
    entrada: {
      territorio: datos.territorio,
      ccaa: datos.ccaa,
      edad: datos.edad,
      edadJubilacion: datos.jubilado ? datos.edad : (datos.edadJubilacion ?? datos.edad),
      pension: cero(datos.pension),
      edadFin: datos.edadFin,
      estrategia: datos.estrategia,
      liquidez: cero(datos.liquidez),
      depositos: cero(datos.depositos),
      fondos: cero(datos.fondos),
      fondosCoste: costeDe("fondos", "fondosCoste"),
      acciones: cero(datos.acciones),
      accionesCoste: costeDe("acciones", "accionesCoste"),
      seguros: cero(datos.seguros),
      segurosCoste: costeDe("seguros", "segurosCoste"),
      /* El ahorro anual solo existe mientras quedan años hasta la jubilación. */
      ahorroAnual: datos.jubilado ? 0 : cero(datos.ahorroAnual),
      tieneEpsv: datos.tieneEpsv,
      epsvPre: cero(datos.epsvPre),
      epsvPreRent: cero(datos.epsvPreRent),
      epsvPost: cero(datos.epsvPost),
      epsvPostRent: cero(datos.epsvPostRent),
      epsvDesglose: datos.epsvDesglose,
      antiguedadConocida: datos.antiguedadConocida,
      antiguedad: datos.antiguedad,
      epsvCobro: datos.epsvCobro,
      epsvPctCapital: datos.epsvPctCapital,
      epsvRenta: datos.epsvRenta,
      epsvAniosRenta: datos.epsvAniosRenta,
      contingencia: datos.contingencia,
      primerCobro: datos.primerCobro,
      dosAnios: datos.dosAnios,
      regimen: datos.regimen,
      rentabilidad: datos.rentabilidad,
      inflacion: datos.inflacion,
      otrasDeducciones: cero(datos.otrasDeducciones),
      estres: datos.estres
    }
  };
}

/** El total de ahorros e inversiones escrito, sin la previsión social. */
export function totalDeAhorros(datos: DatosDeJubilacion): number {
  return (datos.liquidez ?? 0) + (datos.depositos ?? 0) + (datos.fondos ?? 0) + (datos.acciones ?? 0) + (datos.seguros ?? 0);
}

/* ------------------------------------------------- Los saldos de la cartera activa --- */

export interface SaldosDeLaCartera {
  /** Lo que la cartera tiene en fondos de inversión, en euros. */
  fondos: number;
  /** En acciones y ETF. */
  acciones: number;
  /** El peso, en puntos, de lo que no se ha podido clasificar: fuera del catálogo o un índice. */
  pesoSinClasificar: number;
  /** El peso total de la cartera, en puntos. Si no llega a 100, el resto del capital no se reparte. */
  pesoTotal: number;
}

/**
 * Los saldos que la cartera activa pondría en la simulación: su capital repartido por sus pesos, y cada posición
 * en la casilla de su envoltorio fiscal. Un fondo —también uno monetario— tributa como fondo al reembolsarlo; una
 * acción y un ETF, como acción al venderla.
 *
 * No normaliza: si los pesos suman 80, el 20 % del capital no se reparte, y se dice. Y no trae el coste de
 * adquisición, que una cartera modelo no conoce: se queda sin escribir, con su aviso.
 */
export function saldosDeLaCartera(
  posiciones: ReadonlyArray<{ asset_id: string; weight_percent: number }>,
  activos: ReadonlyArray<{ asset_id: string; instrument_type: InstrumentType }>,
  capital: number
): SaldosDeLaCartera {
  const tipoDe = new Map(activos.map((activo) => [activo.asset_id, activo.instrument_type]));
  const saldos: SaldosDeLaCartera = { fondos: 0, acciones: 0, pesoSinClasificar: 0, pesoTotal: 0 };
  for (const posicion of posiciones) {
    const peso = Number.isFinite(posicion.weight_percent) ? Math.max(0, posicion.weight_percent) : 0;
    saldos.pesoTotal += peso;
    const tipo = tipoDe.get(posicion.asset_id);
    if (tipo === "FUND") saldos.fondos += (capital * peso) / 100;
    else if (tipo === "ETF" || tipo === "STOCK") saldos.acciones += (capital * peso) / 100;
    else saldos.pesoSinClasificar += peso;
  }
  return saldos;
}
