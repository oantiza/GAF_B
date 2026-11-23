/**
 * El motor del simulador de jubilación: cálculo puro, sin pantalla.
 *
 * **Qué calcula.** Proyecta año a año la pensión pública (revalorizada con el IPC), las retiradas de los ahorros
 * y de la EPSV o el plan de pensiones, y el IRPF de cada año con la normativa de la residencia fiscal elegida
 * (`fiscal.ts`), y lo da en euros de cada año y con el deflactor que lo lleva a euros de hoy.
 *
 * **De dónde sale.** Es el motor del simulador de NUVIA (`js/nuvia-jubilacion-motor.js`), traído el 13-11-2026.
 * `tests/jubilacionMotor.test.ts` conserva sus cifras de regresión, y el día que se trajo se comparó con el
 * original sobre una rejilla de 4.000 casos, con el mismo resultado en todos. Dos cosas cambian respecto a él:
 *
 * - No se trajo la tabla de esperanza de vida con la que NUVIA proponía un horizonte, porque no cita fuente. Aquí
 *   el horizonte es siempre una edad que escribe el asesor.
 * - Se corrigió la edad de jubilación de quien ya ha cumplido 75 años (ver `normalizar`). Hasta los 75, que es lo
 *   que cubría la comparación, los dos motores dan lo mismo.
 *
 * **Lo que supone, y hay que saber para leer sus cifras.**
 *
 * - Una sola rentabilidad anual para todo el patrimonio, constante. No es una previsión: es una hipótesis que
 *   escribe el asesor, y por eso el resultado va siempre con tres escenarios más. La excepción es la liquidez, que
 *   con una rentabilidad negativa rinde un 0 % en todo el plan (`rendimientoDeLaLiquidez`).
 * - Las retiradas salen de la liquidez y de las inversiones a prorrata de su saldo, sin orden fiscal.
 * - De cada venta tributa la ganancia a coste medio, sin lotes: lo vendido se lleva la parte de su coste que le toca
 *   (arts. 34.1.a y 35.1 LIRPF y sus equivalentes forales). Si se vende en pérdidas, la pérdida se compensa con las
 *   ganancias de lo vendido de los cuatro años siguientes, la más antigua primero, y lo que no cabe en ese plazo caduca
 *   (`F.reglaDeCompensacion`). No se usa el cruce con los rendimientos del capital del mismo año que permiten el
 *   territorio común y Navarra (hasta el 25 %): es la opción prudente que eligió Óscar el 21-11-2026 (hallazgo P1-03),
 *   y ahí el impuesto puede salir algo mayor que el real. Hasta ese día, el coste que salía con la venta en pérdidas se
 *   limitaba a lo vendido, y el resto se quedaba en la cartera: compensaba la pérdida sin plazo. NUVIA sigue así.
 * - Las reglas del IRPF del ejercicio: en los territorios forales (los tres vascos y Navarra) se supone que las
 *   escalas, las deducciones y los límites se actualizan cada año con el IPC; en territorio común se mantienen
 *   fijas, **en euros nominales**, y ahí el impuesto real sale mayor que si se actualizaran (decisión A-159,
 *   `F.escalasConElIpc`). El motor de NUVIA las deja fijas en todos: `calcular(entrada, { escalasDelIrpf:
 *   "fijas" })` da sus cifras, y es lo que usa la prueba de paridad.
 * - No incluye otros ingresos (alquileres, trabajo) ni el IRPF de los años anteriores a la jubilación.
 *
 * Una entrada cuyo territorio o comunidad no esté verificado no calcula: `calcular` devuelve
 * `{ disponible: false }` con el motivo, y ninguna cifra.
 */
import * as F from "./fiscal";
import type { BasesDelCapital, Configuracion, Escala, ParametrosVascos, RentasDelAnio, ResultadoDelIrpf, SaldosDeLaPrevision, TextosDelTerritorio } from "./fiscal";

/** Ajustes del simulador que no son fiscales. */
export const AJUSTES = Object.freeze({
  /** «Mal comienzo»: la rentabilidad de los dos primeros años de jubilación. */
  estres: [-0.12, -0.05] as readonly number[],
  /** Lo que se resta y se suma a la rentabilidad en los escenarios bajo y alto. */
  diferencialEscenarios: 0.015
});

const num = (valor: unknown, defecto = 0): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : defecto;
};
const clamp = (valor: unknown, minimo: number, maximo: number): number => Math.min(maximo, Math.max(minimo, num(valor, minimo)));
const pos = (valor: unknown): number => Math.max(0, num(valor));

export type Estrategia = "consumir" | "conservar";
export type FormaDeCobro = "renta" | "capital" | "mixto";
export type TipoDeRenta = "flexible" | "temporal" | "vitalicia";
export type RegimenDelCapital = "auto" | "transitorio" | "nuevo";

/**
 * Lo que el motor recibe. Los campos `epsv…` valen para una EPSV y para un plan de pensiones: conservan el
 * nombre del motor de origen. En el modelo vasco, `epsvPre` y `epsvPost` son lo aportado antes y desde el año de
 * corte, con su parte de rentabilidad; en los demás, los derechos que derivan de aportaciones anteriores al año
 * de corte y el resto.
 */
export interface EntradaDeJubilacion {
  territorio: string | null;
  ccaa: string | null;
  edad: number;
  edadJubilacion: number;
  /** Pensión pública bruta por paga, en euros de hoy. Son 14 pagas al año. */
  pension: number;
  /** Hasta qué edad llega el plan. */
  edadFin: number;
  estrategia: Estrategia;
  liquidez: number;
  depositos: number;
  fondos: number;
  fondosCoste: number;
  acciones: number;
  accionesCoste: number;
  seguros: number;
  segurosCoste: number;
  /** Ahorro anual hasta la jubilación, en euros de hoy. */
  ahorroAnual: number;
  tieneEpsv: boolean;
  epsvPre: number;
  epsvPreRent: number;
  epsvPost: number;
  epsvPostRent: number;
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
  /** En puntos: 3 es un 3 %. */
  rentabilidad: number;
  /** En puntos. */
  inflacion: number;
  otrasDeducciones: number;
  /** Si se proyecta también el escenario de mal comienzo. */
  estres: boolean;
}

/** El caso con el que el motor de origen fija sus cifras de regresión. Lo usan las pruebas y el ejemplo de pantalla. */
export const DEFECTO: Readonly<EntradaDeJubilacion> = Object.freeze({
  territorio: "bizkaia", ccaa: "referencia",
  edad: 65, edadJubilacion: 65, pension: 2000,
  edadFin: 95, estrategia: "consumir",
  liquidez: 50000, depositos: 0, fondos: 100000, fondosCoste: 75000, acciones: 50000, accionesCoste: 40000, seguros: 0, segurosCoste: 0,
  ahorroAnual: 0,
  tieneEpsv: false, epsvPre: 0, epsvPreRent: 0, epsvPost: 0, epsvPostRent: 0,
  epsvDesglose: "certificado", antiguedadConocida: true, antiguedad: 20,
  epsvCobro: "renta", epsvPctCapital: 50, epsvRenta: "flexible", epsvAniosRenta: 15,
  contingencia: "jubilacion", primerCobro: true, dosAnios: true, regimen: "auto",
  rentabilidad: 3, inflacion: 2, otrasDeducciones: 0, estres: true
});

/** La entrada ya acotada: es con lo que se calcula, y lo que la pantalla enseña cuando un valor se sale de rango. */
export interface EntradaNormalizada {
  territorio: string | null;
  ccaa: string | null;
  edad: number;
  edadJubilacion: number;
  pension: number;
  edadFin: number;
  estrategia: Estrategia;
  liquidez: number;
  depositos: number;
  fondos: number;
  fondosCoste: number;
  acciones: number;
  accionesCoste: number;
  seguros: number;
  segurosCoste: number;
  ahorroAnual: number;
  otrasDeducciones: number;
  tieneEpsv: boolean;
  epsvPre: number;
  epsvPreRent: number;
  epsvPost: number;
  epsvPostRent: number;
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
  regimen: RegimenDelCapital | "reduccion";
  /** En tanto por uno. */
  rentabilidad: number;
  /** En tanto por uno. */
  inflacion: number;
  estres: boolean;
  aniosHastaJubilacion: number;
  aniosPlan: number;
}

/* ------------------------------------------------- El IRPF de un año futuro --- */

/** Los campos de un resultado del IRPF que son tipos y no importes: no cambian de escala. */
const TIPOS_DEL_IRPF: ReadonlySet<string> = new Set(["marginalGeneral", "marginalAhorro", "efectivo"]);

/**
 * El IRPF de las rentas de un año con las reglas actualizadas por `indice`, que es lo que ha subido el IPC desde hoy.
 *
 * Actualizar todas las cifras de la norma —tramos, mínimos, deducciones, bonificaciones, topes— por un mismo factor
 * es lo mismo que llevar las rentas a euros de hoy, aplicar la norma tal como está escrita y devolver el resultado
 * a euros del año. Así no hay que saber cuáles de los parámetros de cada territorio son importes y cuáles tipos.
 * Lo que se declara como otras deducciones es un importe del cliente, no de la norma: se queda en lo que se escribió.
 * Con `indice` 1 es la norma sin más.
 */
function irpfDelAnio(cfg: Configuracion, rentas: RentasDelAnio, indice: number): ResultadoDelIrpf {
  if (indice === 1) return F.irpf(cfg, rentas);
  const deHoy = (importe: number | undefined): number | undefined => (importe === undefined ? undefined : importe / indice);
  const t = F.irpf(cfg, { ...rentas, trabajo: deHoy(rentas.trabajo), ahorro: deHoy(rentas.ahorro), otrasDeducciones: deHoy(rentas.otrasDeducciones), trabajoBruto: deHoy(rentas.trabajoBruto) });
  const delAnio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(t)) delAnio[clave] = typeof valor === "number" && !TIPOS_DEL_IRPF.has(clave) ? valor * indice : valor;
  const linea = (l: F.LineaDelDesglose): F.LineaDelDesglose => ({ ...l, importe: l.importe * indice });
  delAnio.desglose = { general: t.desglose.general.map(linea), ahorro: t.desglose.ahorro.map(linea), cuota: t.desglose.cuota.map(linea) };
  return delAnio as unknown as ResultadoDelIrpf;
}

/** Las formas de calcular el cobro en capital, con sus topes actualizados igual que el resto de la norma. */
function opcionesDelCapital(cfg: Configuracion, o: EntradaNormalizada, ep: SaldosDeLaPrevision, pct: number, indice: number): F.OpcionDeCapital[] {
  if (indice === 1) return F.opcionesCapital(cfg, o, ep, pct);
  const deHoy: SaldosDeLaPrevision = { ...ep, pre: ep.pre / indice, post: ep.post / indice, preRent: ep.preRent / indice, postRent: ep.postRent / indice };
  return F.opcionesCapital(cfg, o, deHoy, pct).map((opcion) => ({
    ...opcion,
    bases: {
      ...opcion.bases,
      bruto: opcion.bases.bruto * indice,
      general: opcion.bases.general * indice,
      ahorro: opcion.bases.ahorro * indice,
      detalle: Object.fromEntries(Object.entries(opcion.bases.detalle).map(([clave, valor]) => [clave, typeof valor === "number" ? valor * indice : valor]))
    }
  }));
}

/* ---------------------------------------------------------------- Retiradas --- */

/**
 * La retirada del primer año que agota el capital `C` en `n` años, con rentabilidad `r` y retiradas que crecen
 * al ritmo `g` (pagos al final de cada año). Es una renta creciente pospagable.
 */
export function retiradaCreciente(C: number, r: number, g: number, n: number): number {
  const c = pos(C);
  const N = Math.max(1, Math.round(num(n, 1)));
  if (!c) return 0;
  if (Math.abs(r - g) < 1e-10) return (c * (1 + r)) / N;
  const d = 1 - Math.pow((1 + g) / (1 + r), N);
  return Math.abs(d) < 1e-12 ? c / N : (c * (r - g)) / d;
}

/**
 * Lo que rinde la liquidez —y lo cobrado de una vez, que se le suma— en todo el plan, antes y después de jubilarse: la
 * rentabilidad elegida, salvo que sea negativa, y entonces un 0 %. Antes de jubilarse, desde el 17-11-2026 (A-191). El efectivo no pierde euros, solo poder de compra, y eso ya lo
 * recoge la inflación. Rige igual en la proyección de cada año que al calcular la retirada que agota los ahorros: si
 * no, con una rentabilidad negativa el plan retiraba menos de lo que la proyección podía pagar, y sobraba dinero al
 * final (auditoría del 16-11-2026, JUB-6 de la tabla de bajos; decidido por Óscar el 17-11-2026). NUVIA da a la
 * liquidez la rentabilidad negativa al calcular la retirada: ver `DISTINTO_A_PROPOSITO` en la prueba de paridad.
 */
export const rendimientoDeLaLiquidez = (r: number): number => Math.max(r, 0);

/**
 * La retirada del primer año que agota en `n` años la liquidez `L`, que rinde `rl`, y las inversiones `V`, que rinden
 * `r`, con retiradas que crecen al ritmo `g` y salen de las dos a prorrata de su saldo (pagos al final de cada año).
 *
 * Retirar a prorrata reduce los dos saldos en la misma proporción, así que tras el año `k` queda una fracción de lo
 * que habría sin retiradas, `P(k) = L·(1 + rl)^k + V·(1 + r)^k`. Cada retirada se lleva `w(k) / P(k)` de esa fracción, y
 * agotarlo todo en el año `n` es `W · Σ (1 + g)^(k − 1) / P(k) = 1`, de `k = 1` a `n`. Cuando las dos rinden lo mismo es
 * la renta creciente de `retiradaCreciente`, y entonces se usa esa.
 */
export function retiradaQueAgota(L: number, V: number, rl: number, r: number, g: number, n: number): number {
  const l = pos(L);
  const v = pos(V);
  if (!l || !v || rl === r) return retiradaCreciente(l + v, l ? rl : r, g, n);
  const N = Math.max(1, Math.round(num(n, 1)));
  let suma = 0;
  for (let k = 1; k <= N; k += 1) suma += Math.pow(1 + g, k - 1) / (l * Math.pow(1 + rl, k) + v * Math.pow(1 + r, k));
  return 1 / suma;
}

/* ------------------------------------------------------------ Normalización --- */

const IMPORTES = ["liquidez", "depositos", "fondos", "fondosCoste", "acciones", "accionesCoste", "seguros", "segurosCoste", "ahorroAnual", "otrasDeducciones"] as const;
const FORMAS_DE_COBRO: readonly FormaDeCobro[] = ["renta", "capital", "mixto"];
const TIPOS_DE_RENTA: readonly TipoDeRenta[] = ["flexible", "temporal", "vitalicia"];
const REGIMENES: readonly RegimenDelCapital[] = ["auto", "transitorio", "nuevo"];

export function normalizar(entrada?: Partial<EntradaDeJubilacion> | null): EntradaNormalizada {
  const s: EntradaDeJubilacion = { ...DEFECTO, ...(entrada ?? {}) };
  const territorio = typeof s.territorio === "string" ? s.territorio : null;
  const ccaa = typeof s.ccaa === "string" ? s.ccaa : null;
  const cfg = F.configuracion(territorio, ccaa);
  const pv = cfg ? cfg.parametros.prevision : null;
  const vasco = pv?.modelo === "vasco";
  const edad = Math.round(clamp(s.edad, 40, 95));
  /* La jubilación no puede ser anterior a la edad de hoy, ni posterior a los 75 salvo que el cliente ya los haya
     cumplido. El motor de origen acotaba a 75 sin esa salvedad: a un jubilado de 80 años le empezaba el plan a los
     75, cinco años atrás, con la pensión deflactada y un IRPF menor que el real (corregido al traerlo, 13-11-2026). */
  const edadJubilacion = Math.round(clamp(s.edadJubilacion, edad, Math.max(edad, 75)));
  const tieneEpsv = Boolean(s.tieneEpsv);
  const epsvDesglose = vasco && s.epsvDesglose === "estimacion" ? "estimacion" : "certificado";
  const antiguedadConocida = s.antiguedadConocida !== false;
  const antiguedad = Math.round(clamp(s.antiguedad, 1, 60));
  /* Sin desglose el saldo se da por anterior a 2026, salvo que la antigüedad diga que puede no serlo: entonces va
     entero al tramo posterior (`saldoSinDesgloseEsPosterior`, N05). */
  const todoPosterior = epsvDesglose === "estimacion" && F.saldoSinDesgloseEsPosterior(antiguedadConocida, antiguedad);
  const saldoPre = tieneEpsv ? pos(s.epsvPre) : 0;
  const saldoPost = tieneEpsv ? pos(s.epsvPost) : 0;
  /* Sin desglose no hay tramos: el saldo es uno, y va entero a uno de los dos. Un saldo posterior que quede de cuando se
     escribió con certificado no se conserva aparte: hasta el 22-11-2026 se conservaba, y con 100.000 € escritos en el tramo
     posterior la pantalla decía «aportado hasta 2025» mientras el motor aplicaba el régimen de 2026 (H1-03 de la auditoría
     del 22-11-2026). Con certificado, cada tramo es el suyo. */
  const sinDesglose = epsvDesglose === "estimacion";
  const epsvPre = sinDesglose ? (todoPosterior ? 0 : saldoPre + saldoPost) : saldoPre;
  const epsvPost = sinDesglose ? (todoPosterior ? saldoPre + saldoPost : 0) : saldoPost;
  /* La rentabilidad de un tramo certificado puede ser negativa. La ganancia no pasa de su saldo (lo aportado no puede ser
     negativo); la pérdida no tiene más tope que lo aportado, que no se escribe: con 10.000 € de derechos y 30.000 €
     aportados, el tramo pierde 20.000 €. La diferencia positiva que grava la norma es la de la EPSV entera, y eso lo
     acota `basesCapitalVasco` (N06). */
  const rentDelTramo = (valor: unknown, saldo: number): number => Math.min(saldo, num(valor));
  const epsvCobro = FORMAS_DE_COBRO.includes(s.epsvCobro) ? s.epsvCobro : "renta";
  const importes = Object.fromEntries(IMPORTES.map((clave) => [clave, pos(s[clave])])) as Record<(typeof IMPORTES)[number], number>;
  const edadFin = Math.round(clamp(Math.round(num(s.edadFin, 95)), edadJubilacion + 1, 110));
  return {
    territorio,
    ccaa,
    edad,
    edadJubilacion,
    pension: pos(s.pension),
    edadFin,
    estrategia: s.estrategia === "conservar" ? "conservar" : "consumir",
    ...importes,
    tieneEpsv,
    epsvPre,
    epsvPost,
    /* Fuera del modelo vasco no hay desglose de rentabilidad: todo el cobro es trabajo. */
    epsvPreRent: vasco ? rentDelTramo(s.epsvPreRent, epsvPre) : 0,
    epsvPostRent: vasco ? rentDelTramo(s.epsvPostRent, epsvPost) : 0,
    epsvDesglose,
    antiguedadConocida,
    antiguedad,
    epsvCobro,
    epsvPctCapital: epsvCobro === "capital" ? 100 : epsvCobro === "renta" ? 0 : clamp(s.epsvPctCapital, 5, 95),
    epsvRenta: TIPOS_DE_RENTA.includes(s.epsvRenta) ? s.epsvRenta : "flexible",
    epsvAniosRenta: Math.round(clamp(s.epsvAniosRenta, pv ? pv.rentaMinimaAnios : 15, 40)),
    contingencia: vasco ? s.contingencia || "jubilacion" : "jubilacion",
    primerCobro: s.primerCobro !== false,
    /* Sin desglose y con la antigüedad conocida, el requisito puede ser imposible: entonces no se aplica la reducción
       aunque la casilla llegue marcada (una entrada guardada, un ejemplo). Lo dice `notaDeLosDosAnios` (H1-03). */
    dosAnios:
      s.dosAnios !== false &&
      !F.dosAniosNoPuedeCumplirse({ sinDesglose: epsvDesglose === "estimacion", antiguedadConocida, antiguedad, aniosHastaCobro: edadJubilacion - edad, contingencia: vasco ? s.contingencia || "jubilacion" : "jubilacion" }),
    regimen: vasco && REGIMENES.includes(s.regimen) ? s.regimen : vasco ? "auto" : "reduccion",
    rentabilidad: clamp(s.rentabilidad, -2, 10) / 100,
    inflacion: clamp(s.inflacion, 0, 6) / 100,
    estres: s.estres !== false,
    aniosHastaJubilacion: edadJubilacion - edad,
    aniosPlan: edadFin - edadJubilacion
  };
}

/** Lo que el motor ha tenido que corregir en la entrada, o lo que le falta para dar un resultado. */
export function avisos(entrada?: Partial<EntradaDeJubilacion> | null): string[] {
  const s: EntradaDeJubilacion = { ...DEFECTO, ...(entrada ?? {}) };
  const a: string[] = [];
  if (num(s.edadJubilacion) < num(s.edad)) a.push("La edad de jubilación no puede ser anterior a la edad actual: se usa la edad actual.");
  if (num(s.edadFin) <= Math.max(num(s.edad), num(s.edadJubilacion))) a.push("La edad hasta la que se planifica debe ser posterior a la jubilación.");
  const cfg = F.configuracion(typeof s.territorio === "string" ? s.territorio : null, s.ccaa);
  const vasco = cfg?.parametros.prevision.modelo === "vasco";
  if (s.tieneEpsv && vasco && s.epsvDesglose === "certificado" && (num(s.epsvPreRent) > num(s.epsvPre) || num(s.epsvPostRent) > num(s.epsvPost))) {
    a.push("La rentabilidad de la EPSV no puede superar su saldo: se limita al saldo.");
  }
  const sinAhorros = !(pos(s.liquidez) + pos(s.depositos) + pos(s.fondos) + pos(s.acciones) + pos(s.seguros));
  const sinPrevision = !(s.tieneEpsv && pos(s.epsvPre) + pos(s.epsvPost));
  if (!pos(s.pension) && sinAhorros && sinPrevision) {
    a.push(`Falta al menos una pensión, ahorros o ${vasco || !cfg ? "una EPSV" : "un plan de pensiones"} para dar un resultado.`);
  }
  return a;
}

/* ----------------------------------------------------------- Previsión social --- */

export type MetodoDelRatio = "sin-epsv" | "trabajo" | "certificado" | "antiguedad" | "sin-antiguedad";

/** Qué parte de la previsión es rentabilidad, y cómo se ha sabido. */
function ratioRentabilidad(cfg: Configuracion, o: EntradaNormalizada, pre: number, preRent: number, post: number, postRent: number): { ratio: number; metodo: MetodoDelRatio } {
  const total = pre + post;
  if (!total) return { ratio: 0, metodo: "sin-epsv" };
  if (cfg.parametros.prevision.modelo !== "vasco") return { ratio: 0, metodo: "trabajo" };
  /* Sin desglose, `preRent` y `postRent` ya llevan la estimación reglada (`situacionInicial`): la cuenta es la misma. */
  const ratio = (preRent + postRent) / total;
  if (o.epsvDesglose === "certificado") return { ratio, metodo: "certificado" };
  return { ratio, metodo: o.antiguedadConocida ? "antiguedad" : "sin-antiguedad" };
}

/* ------------------------------------------------- Situación a la jubilación --- */

export interface SituacionInicial {
  /** Liquidez y depósitos. */
  liq: number;
  /** Valor de fondos, acciones y seguros. */
  V: number;
  /** Su coste de adquisición. */
  K: number;
  aportado: number;
  ep: SaldosDeLaPrevision & { metodo: MetodoDelRatio };
}

/** Lleva los saldos de hoy hasta la jubilación, con la rentabilidad `r` y el ahorro anual revalorizado. */
function situacionInicial(cfg: Configuracion, o: EntradaNormalizada, r: number): SituacionInicial {
  const A = o.aniosHastaJubilacion;
  const i = o.inflacion;
  const proporcional = cfg.parametros.prevision.crecimientoPre === "proporcional";
  let liq = o.liquidez + o.depositos;
  let V = o.fondos + o.acciones + o.seguros;
  let K = o.fondosCoste + o.accionesCoste + o.segurosCoste;
  let pre = o.epsvPre;
  let post = o.epsvPost;
  /* Sin desglose (modelo vasco), la estimación reglada da la rentabilidad del saldo de hoy, y solo de él: lo que crezca
     hasta la jubilación va al tramo posterior y es todo rentabilidad, como con certificado. Antes la estimación se
     aplicaba a la prestación entera, y con diez años al 5 % unos 47.000 € de rentabilidad de cada 100.000 € del saldo de
     hoy contaban como aportación (decisión de Óscar del 22-11-2026). */
  const estimada = cfg.parametros.prevision.modelo === "vasco" && o.epsvDesglose === "estimacion";
  const estimacion = estimada ? F.ratioEstimado(cfg, o.antiguedadConocida, o.antiguedad) : 0;
  const preRent = estimada ? pre * estimacion : o.epsvPreRent;
  let postRent = estimada ? post * estimacion : o.epsvPostRent;
  let aportado = 0;
  for (let y = 1; y <= A; y += 1) {
    /* Antes de jubilarse, la liquidez rinde lo mismo que después: con una rentabilidad negativa, un 0 % (decisión de
       Óscar del 17-11-2026, A-191). Si no, el mismo dinero perdía euros hasta la jubilación y dejaba de perderlos ese día. */
    liq *= 1 + rendimientoDeLaLiquidez(r);
    V *= 1 + r;
    const creci = (pre + post) * r;
    if (proporcional && pre + post > 0) {
      const q = pre / (pre + post);
      pre += creci * q;
      post += creci * (1 - q);
    } else {
      /* Modelo vasco: lo generado desde 2026 va al tramo posterior. */
      post += creci;
      postRent += creci;
    }
    const ap = o.ahorroAnual * Math.pow(1 + i, y - 1);
    V += ap;
    K += ap;
    aportado += ap;
  }
  /* Con una pérdida hasta la jubilación, sin desglose se sigue estimando sobre el saldo final, como antes: cómo debe
     restar la pérdida a la rentabilidad estimada es una cuestión aparte, pendiente de decisión. */
  if (estimada && post < o.epsvPost) postRent = post * estimacion;
  const rr = ratioRentabilidad(cfg, o, pre, preRent, post, postRent);
  return { liq, V, K, aportado, ep: { pre, post, preRent, postRent, ratio: rr.ratio, metodo: rr.metodo } };
}

/* -------------------------------------------------------- Plan y proyección --- */

/** Una forma de calcular el cobro en capital, con su impuesto y lo que queda. */
export interface OpcionCalculada extends F.OpcionDeCapital {
  /** El IRPF que este cobro añade al del primer año. */
  impuesto: number;
  neto: number;
}

export interface CobroEnCapital {
  bruto: number;
  opciones: OpcionCalculada[];
  elegido: F.OpcionDeCapital["clave"];
  /** Se ha aplicado el régimen de menor impuesto estimado, porque así se pidió. */
  automatico: boolean;
  impuesto: number;
  neto: number;
  bases: BasesDelCapital;
  transitorio?: { bases: BasesDelCapital; impuesto: number; neto: number };
  nuevo?: { bases: BasesDelCapital; impuesto: number; neto: number };
  reduccion?: { bases: BasesDelCapital; impuesto: number; neto: number };
}

export interface Plan {
  o: EntradaNormalizada;
  cfg: Configuracion;
  ini: SituacionInicial;
  /** La parte de la previsión que se cobra de una vez, en tanto por uno. */
  pct: number;
  /** La parte de la previsión que queda para cobrar en renta. */
  Epsv0: number;
  /** La pensión del primer año de jubilación, en euros de ese año. */
  pension1: number;
  /** Si la renta de la previsión cumple los requisitos de exención de su rentabilidad. */
  exenta: boolean;
  /** El cobro periódico de la previsión previsto para el año `k` del plan. */
  pagoEpsv: (k: number) => number;
  /**
   * Por cuánto se actualizan las reglas del IRPF en el año `k` del plan: lo que ha subido el IPC supuesto desde hoy,
   * o 1 si en ese territorio se dejan fijas (`F.escalasConElIpc`).
   */
  indice: (k: number) => number;
  /** La retirada de ahorros del primer año. */
  W1: number;
  capital: CobroEnCapital | null;
  netoCapital: number;
}

/** Las rentas imponibles del primer año, para calcular lo que añade el cobro en capital. */
function anio1Rentas(cfg: Configuracion, ini: SituacionInicial, netoCapital: number, W1: number, pension1: number, pago: number, ratio: number, exenta: boolean, r: number) {
  let liq = ini.liq + netoCapital;
  let V = ini.V;
  const K = ini.K;
  const interes = liq * rendimientoDeLaLiquidez(r);
  liq += interes;
  V *= 1 + r;
  const disp = liq + V;
  const w = Math.min(W1, disp);
  const deInv = disp ? (w * V) / disp : 0;
  const ganancia = V > K && V > 0 ? deInv * (1 - K / V) : 0;
  const rp = F.rentaPeriodica(cfg, pago, ratio, exenta);
  return { trabajo: pension1 + rp.trabajo, ahorro: Math.max(0, interes) + ganancia + rp.ahorro, trabajoBruto: pension1 + pago };
}

function construirPlan(cfg: Configuracion, o: EntradaNormalizada, actualiza: boolean): Plan {
  const r = o.rentabilidad;
  const i = o.inflacion;
  const n = o.aniosPlan;
  const A = o.aniosHastaJubilacion;
  const indice = (k: number): number => (actualiza ? Math.pow(1 + i, A + k - 1) : 1);
  const ini = situacionInicial(cfg, o, r);
  const pct = o.epsvPctCapital / 100;
  const epsvTotal = ini.ep.pre + ini.ep.post;
  const Epsv0 = epsvTotal * (1 - pct);
  const pension1 = o.pension * 14 * Math.pow(1 + i, A);
  const exenta = o.epsvRenta !== "flexible";

  /* Los pagos periódicos de la previsión, con el plan del escenario base. */
  const pagoEpsv = (k: number): number => {
    if (!Epsv0) return 0;
    if (o.epsvRenta === "temporal") return k <= o.epsvAniosRenta ? retiradaCreciente(Epsv0, r, 0, o.epsvAniosRenta) : 0;
    if (o.epsvRenta === "vitalicia") return retiradaCreciente(Epsv0, r, 0, n);
    const w1 = o.estrategia === "conservar" ? Epsv0 * Math.max(0, r - i) : retiradaCreciente(Epsv0, r, i, n);
    return w1 * Math.pow(1 + i, k - 1);
  };

  /* Cobro en capital: el impuesto depende del resto de rentas del primer año, y la retirada de ahorros depende
     del neto cobrado. Se resuelve por iteración. */
  const opciones = opcionesDelCapital(cfg, o, ini.ep, pct, indice(1));
  let netoCapital = 0;
  let capital: CobroEnCapital | null = null;
  /* La liquidez rinde lo de `rendimientoDeLaLiquidez`, aquí como en la proyección. Al conservar no cambia nada: con
     una rentabilidad negativa no hay rentabilidad por encima del IPC que retirar, ni de la liquidez ni del resto. */
  const rl = rendimientoDeLaLiquidez(r);
  const retiradaPlan = (neto: number): number => {
    const C = ini.liq + ini.V + neto;
    if (o.estrategia === "conservar") return C * Math.max(0, r - i);
    /* Con la misma rentabilidad para todo, la cuenta de siempre y en el mismo orden: así da lo mismo que NUVIA. */
    return rl === r ? retiradaCreciente(C, r, i, n) : retiradaQueAgota(ini.liq + neto, ini.V, rl, r, i, n);
  };
  for (let it = 0; it < 4; it += 1) {
    const retirada = retiradaPlan(netoCapital);
    const y1 = anio1Rentas(cfg, ini, netoCapital, retirada, pension1, pagoEpsv(1), ini.ep.ratio, exenta, r);
    const sin = irpfDelAnio(cfg, { trabajo: y1.trabajo, ahorro: y1.ahorro, edad: o.edadJubilacion, otrasDeducciones: o.otrasDeducciones, trabajoBruto: y1.trabajoBruto }, indice(1)).total;
    const coste = (b: BasesDelCapital): number =>
      irpfDelAnio(cfg, { trabajo: y1.trabajo + b.general, ahorro: y1.ahorro + b.ahorro, edad: o.edadJubilacion, otrasDeducciones: o.otrasDeducciones, trabajoBruto: y1.trabajoBruto + b.bruto }, indice(1)).total - sin;
    const calc: OpcionCalculada[] = opciones.map((op) => {
      const impuesto = coste(op.bases);
      return { ...op, impuesto, neto: op.bases.bruto - impuesto };
    });
    let elegido: F.OpcionDeCapital["clave"] = calc[0].clave;
    const automatico = calc.length > 1 && o.regimen === "auto";
    /* Sin derechos anteriores a 2026 el régimen transitorio no tiene sobre qué aplicarse y da lo mismo que el de 2026,
       y en el empate se quedaba con él por ir primero: se elige el de 2026. Es el caso sin desglose con un año de
       antigüedad o menos (N05). */
    const sinTramoAnterior = ini.ep.pre <= 0 && calc.some((x) => x.clave === "nuevo");
    if (calc.length > 1) {
      elegido = !automatico ? (o.regimen as F.OpcionDeCapital["clave"]) : sinTramoAnterior ? "nuevo" : calc.reduce((m, x) => (x.impuesto < m.impuesto ? x : m), calc[0]).clave;
    }
    const sel = calc.find((x) => x.clave === elegido) ?? calc[0];
    const siguiente: CobroEnCapital = { bruto: calc[0].bases.bruto, opciones: calc, elegido: sel.clave, automatico, impuesto: sel.impuesto, neto: sel.neto, bases: sel.bases };
    for (const x of calc) siguiente[x.clave] = { bases: x.bases, impuesto: x.impuesto, neto: x.neto };
    capital = siguiente;
    if (Math.abs(siguiente.neto - netoCapital) < 0.5) {
      netoCapital = siguiente.neto;
      break;
    }
    netoCapital = siguiente.neto;
  }
  const W1 = retiradaPlan(netoCapital);
  return { o, cfg, ini, pct, Epsv0, pension1, exenta, pagoEpsv, indice, W1, capital: capital && capital.bruto > 0 ? capital : null, netoCapital };
}

/** Un año del plan. Todos los importes, en euros de ese año; `deflactor` los lleva a euros de hoy. */
export interface FilaAnual {
  /** El año del plan, desde 1. */
  anio: number;
  edad: number;
  pension: number;
  retiradaAhorros: number;
  retiradaEpsv: number;
  bruto: number;
  impuesto: number;
  /** El IRPF que la pensión pagaría sola. */
  impuestoPension: number;
  /** Lo que añaden las retiradas. */
  impuestoResto: number;
  neto: number;
  pensionNeta: number;
  restoNeto: number;
  interes: number;
  /** La ganancia de lo vendido que entra en la base del ahorro: la de la venta, menos las pérdidas que compensa. */
  ganancia: number;
  /** La ganancia de la venta del año, antes de compensar pérdidas: lo vendido menos su coste. */
  gananciaBruta: number;
  /** La pérdida de la venta del año, en positivo: el coste de lo vendido menos lo cobrado. */
  perdida: number;
  /** Lo que las pérdidas de años anteriores le quitan este año a la ganancia. */
  compensado: number;
  /** Las pérdidas que, al cierre del año, cumplen su plazo sin haberse compensado: se pierden. */
  perdidaCaducada: number;
  /** Las pérdidas que quedan por compensar al cierre del año. */
  perdidasPendientes: number;
  /** La parte de la retirada de ahorros que es capital propio y no tributa: lo retirado menos la ganancia de la venta. */
  principal: number;
  epsvTrabajo: number;
  epsvRent: number;
  epsvRentExenta: number;
  irpf: ResultadoDelIrpf;
  /** El patrimonio que queda al cierre del año. */
  saldo: number;
  deflactor: number;
  /** Lo que el plan preveía retirar ese año. */
  previsto: number;
}

export type ClaveDeEscenario = "conservador" | "base" | "optimista" | "estres";

export interface Proyeccion {
  r: number;
  estres: boolean;
  filas: FilaAnual[];
  /** El año del plan en que el patrimonio se agota, si se agota antes del final. */
  agotado: number | null;
  edadAgotado: number | null;
  saldoInicial: number;
  saldoFinal: number;
  /** Qué parte de las retiradas previstas llega a pagar el patrimonio. */
  cobertura: number;
}

export interface Escenario extends Proyeccion {
  clave: ClaveDeEscenario;
  nombre: string;
}

/** Una pérdida de lo vendido que queda por compensar, con el año del plan en que se produjo. */
export interface PerdidaPendiente {
  origen: number;
  importe: number;
}

/** Fondos, acciones y seguros antes de una venta: su valor, su coste y las pérdidas por compensar, de la más antigua a la más reciente. */
export interface CarteraFiscal {
  V: number;
  K: number;
  pendientes: readonly PerdidaPendiente[];
}

export interface Venta extends CarteraFiscal {
  /** El coste que sale con lo vendido. */
  costeRetirado: number;
  gananciaBruta: number;
  perdida: number;
  compensado: number;
  /** Lo que entra en la base del ahorro. */
  ganancia: number;
  perdidaCaducada: number;
  perdidasPendientes: number;
}

/**
 * Vende `deInv` euros de la cartera en el año `anio` del plan, y compensa (hallazgo P1-03; Óscar, 21-11-2026).
 *
 * - Lo vendido se lleva la parte de su coste que le toca, gane o pierda: `deInv × K / V` (arts. 34.1.a y 35.1 LIRPF y
 *   sus equivalentes forales). Si se vende todo, sale todo el coste. Hasta el 21-11-2026 el coste que salía se limitaba a
 *   lo cobrado, y con la venta en pérdidas el resto se quedaba en la cartera y rebajaba las ganancias de después, sin plazo.
 * - Una ganancia se compensa con las pérdidas pendientes, la más antigua primero y en la cuantía máxima que quepa (art.
 *   49.2 LIRPF, 54.3 DFL 4/2008 navarro, 66.2 de las tres normas vascas). Nunca con los intereses: ver
 *   `F.reglaDeCompensacion`.
 * - Una pérdida queda pendiente con su año. La del año `anio − plazo` ha tenido ya sus `plazo` años siguientes: lo que
 *   quede de ella caduca al cierre de este.
 *
 * No cambia la cartera que recibe: devuelve la de después.
 */
export function vender(cartera: CarteraFiscal, deInv: number, anio: number, plazo: number): Venta {
  const { V, K } = cartera;
  /* Vender todo (`deInv = V`) se lleva todo el coste. Sin caso aparte: con la misma cuenta que el motor de NUVIA, los
     restos de coma flotante de un plan que se agota son los mismos en las dos copias. */
  const costeRetirado = V > 0 ? deInv * (K / V) : 0;
  const resultado = deInv - costeRetirado;
  const gananciaBruta = Math.max(0, resultado);
  const perdida = Math.max(0, -resultado);
  let compensado = 0;
  const tras = cartera.pendientes.map((p) => {
    const usa = Math.max(0, Math.min(p.importe, gananciaBruta - compensado));
    compensado += usa;
    return { origen: p.origen, importe: p.importe - usa };
  });
  if (perdida > 0) tras.push({ origen: anio, importe: perdida });
  let perdidaCaducada = 0;
  const pendientes = tras.filter((p) => {
    if (p.origen + plazo > anio) return p.importe > 1e-9;
    perdidaCaducada += p.importe;
    return false;
  });
  return {
    V: Math.max(0, V - deInv),
    K: Math.max(0, K - costeRetirado),
    pendientes,
    costeRetirado,
    gananciaBruta,
    perdida,
    compensado,
    ganancia: gananciaBruta - compensado,
    perdidaCaducada,
    perdidasPendientes: pendientes.reduce((suma, p) => suma + p.importe, 0)
  };
}

/**
 * Proyecta un escenario con el plan del escenario base —las mismas retiradas previstas— y una rentabilidad
 * distinta o una secuencia de mal comienzo. Así los escenarios dicen cuánto dura el dinero, no cuánto se
 * retiraría en cada uno.
 */
function proyectar(plan: Plan, r: number, estres: boolean): Proyeccion {
  const { o, cfg, ini, pension1, exenta, pagoEpsv, W1 } = plan;
  const i = o.inflacion;
  const n = o.aniosPlan;
  const A = o.aniosHastaJubilacion;
  const ratio = ini.ep.ratio;
  let liq = ini.liq + plan.netoCapital;
  let V = ini.V;
  let K = ini.K;
  let E = plan.Epsv0;
  let pendientes: readonly PerdidaPendiente[] = [];
  const { plazo } = F.reglaDeCompensacion(cfg);
  const filas: FilaAnual[] = [];
  let agotado: number | null = null;
  let previstoTotal = 0;
  let pagadoTotal = 0;
  const saldo0 = liq + V + E;
  for (let k = 1; k <= n; k += 1) {
    const edad = o.edadJubilacion + k - 1;
    const rk = estres && k <= AJUSTES.estres.length ? AJUSTES.estres[k - 1] : r;
    const interes = liq * rendimientoDeLaLiquidez(r);
    liq += interes;
    V *= 1 + rk;
    E *= 1 + rk;
    const objetivo = W1 * Math.pow(1 + i, k - 1);
    const disp = liq + V;
    const w = Math.min(objetivo, disp);
    const deInv = disp ? (w * V) / disp : 0;
    const deLiq = w - deInv;
    const venta = vender({ V, K, pendientes }, deInv, k, plazo);
    const { ganancia, gananciaBruta, perdida, compensado, perdidaCaducada, perdidasPendientes } = venta;
    pendientes = venta.pendientes;
    K = venta.K;
    V = venta.V;
    liq = Math.max(0, liq - deLiq);
    const pagoObj = pagoEpsv(k);
    const pago = Math.min(pagoObj, E);
    E = Math.max(0, E - pago);
    previstoTotal += objetivo + pagoObj;
    pagadoTotal += w + pago;
    const pension = pension1 * Math.pow(1 + i, k - 1);
    const rp = F.rentaPeriodica(cfg, pago, ratio, exenta);
    const epsvTrabajo = rp.trabajo;
    const epsvRent = rp.rentabilidad;
    const trabajo = pension + epsvTrabajo;
    const ahorro = interes + ganancia + rp.ahorro;
    const t = irpfDelAnio(cfg, { trabajo, ahorro, edad, otrasDeducciones: o.otrasDeducciones, trabajoBruto: pension + pago }, plan.indice(k));
    const tPension = irpfDelAnio(cfg, { trabajo: pension, ahorro: 0, edad, otrasDeducciones: o.otrasDeducciones, trabajoBruto: pension }, plan.indice(k));
    const bruto = pension + w + pago;
    const saldo = liq + V + E;
    if (agotado === null && saldo < 1 && objetivo + pagoObj > 0 && k < n) agotado = k;
    const deflactor = Math.pow(1 + i, A + k - 1);
    filas.push({
      anio: k, edad, pension, retiradaAhorros: w, retiradaEpsv: pago, bruto,
      impuesto: t.total, impuestoPension: tPension.total, impuestoResto: t.total - tPension.total,
      neto: bruto - t.total, pensionNeta: pension - tPension.total, restoNeto: w + pago - (t.total - tPension.total),
      interes, ganancia, gananciaBruta, perdida, compensado, perdidaCaducada, perdidasPendientes, principal: w - gananciaBruta, epsvTrabajo, epsvRent, epsvRentExenta: rp.exento,
      irpf: t, saldo, deflactor, previsto: objetivo + pagoObj
    });
  }
  const fin = filas[filas.length - 1];
  return {
    r, estres, filas, agotado, edadAgotado: agotado ? o.edadJubilacion + agotado : null,
    saldoInicial: saldo0, saldoFinal: fin ? fin.saldo : 0, cobertura: previstoTotal ? pagadoTotal / previstoTotal : 1
  };
}

/* ---------------------------------------------------------------- El resultado --- */

export type EstadoSinCalculo = "sin-territorio" | "desconocido" | "desconocida" | "en-preparacion";

export interface ResultadoNoDisponible {
  disponible: false;
  estado: EstadoSinCalculo;
  mensaje: string;
  entrada: EntradaNormalizada;
  cfg: Configuracion | null;
  escenarios: [];
  base: null;
  anio1: null;
  resumen: null;
  capital: null;
  avisos: string[];
}

export interface Resumen {
  /** Todo en euros del primer año de jubilación; `deflactor1` lo lleva a euros de hoy. */
  netoMensual: number;
  brutoMensual: number;
  impuestoMensual: number;
  pensionNetaMensual: number;
  restoNetoMensual: number;
  deflactor1: number;
  patrimonioHoy: number;
  patrimonioJubilacion: number;
  ratioEpsv: number;
  metodoEpsv: MetodoDelRatio;
}

export interface ParametrosDelResultado {
  escalaGeneral: Escala;
  escalaAhorro: Escala;
  prevision: F.Prevision;
  /** La escala general que se enseña: en el estatal, estatal más autonómica. */
  escalaGeneralVisible: Escala;
  escalaAutonomica: Escala | null;
}

export interface ResultadoDisponible {
  disponible: true;
  cfg: Configuracion;
  textos: TextosDelTerritorio;
  limites: string[];
  entrada: EntradaNormalizada;
  parametros: ParametrosDelResultado;
  plan: Plan;
  /** Rentabilidad más baja, la hipótesis, más alta y, si se pidió, el mal comienzo. En ese orden. */
  escenarios: Escenario[];
  base: Escenario;
  anio1: FilaAnual;
  resumen: Resumen;
  capital: CobroEnCapital | null;
  /** Si las reglas del IRPF se han actualizado cada año con el IPC supuesto (decisión A-159) o se han dejado fijas. */
  escalasConElIpc: boolean;
  avisos: string[];
}

export type ResultadoDeJubilacion = ResultadoDisponible | ResultadoNoDisponible;

/** El resultado cuando el territorio o la comunidad no calculan: el motivo, y ninguna cifra. */
function noDisponible(o: EntradaNormalizada, cfg: Configuracion | null, entrada?: Partial<EntradaDeJubilacion> | null): ResultadoNoDisponible {
  let estado: EstadoSinCalculo = "desconocido";
  let mensaje: string;
  if (!o.territorio) {
    estado = "sin-territorio";
    mensaje = "Elige la residencia fiscal del cliente para calcular.";
  } else if (!cfg) {
    mensaje = `No se reconoce el territorio «${o.territorio}». Elige la residencia fiscal en el selector.`;
  } else if (cfg.estado === "desconocida") {
    estado = "desconocida";
    mensaje = `No se reconoce la comunidad autónoma «${o.ccaa ?? ""}». Elige una en el selector.`;
  } else {
    estado = "en-preparacion";
    mensaje = `${cfg.ccaa ? cfg.ccaa.nombre : cfg.nombre} está en preparación: su escala autonómica aún no se ha verificado en fuente oficial, así que el simulador no calcula con ella. Se puede ver una estimación con la escala de referencia (art. 65 LIRPF), que no es la de esa comunidad.`;
  }
  return { disponible: false, estado, mensaje, entrada: o, cfg, escenarios: [], base: null, anio1: null, resumen: null, capital: null, avisos: avisos(entrada) };
}

/** Lo que se le puede pedir al cálculo además de la entrada. */
export interface OpcionesDelCalculo {
  /** `"fijas"` deja las reglas del IRPF en euros nominales en todos los territorios, como el motor de NUVIA. */
  escalasDelIrpf?: "fijas";
}

export function calcular(entrada?: Partial<EntradaDeJubilacion> | null, opciones: OpcionesDelCalculo = {}): ResultadoDeJubilacion {
  const o = normalizar(entrada);
  const cfg = F.configuracion(o.territorio, o.ccaa);
  if (!F.disponible(cfg)) return noDisponible(o, cfg, entrada);
  const actualiza = opciones.escalasDelIrpf !== "fijas" && F.escalasConElIpc(cfg);
  const plan = construirPlan(cfg, o, actualiza);
  const r = o.rentabilidad;
  const d = AJUSTES.diferencialEscenarios;
  const base: Escenario = { ...proyectar(plan, r, false), clave: "base", nombre: "La hipótesis" };
  const escenarios: Escenario[] = [
    { ...proyectar(plan, Math.max(-0.02, r - d), false), clave: "conservador", nombre: "Rentabilidad más baja" },
    base,
    { ...proyectar(plan, Math.min(0.12, r + d), false), clave: "optimista", nombre: "Rentabilidad más alta" }
  ];
  if (o.estres) escenarios.push({ ...proyectar(plan, r, true), clave: "estres", nombre: "Mal comienzo" });
  const y1 = base.filas[0];
  const patrimonioHoy = o.liquidez + o.depositos + o.fondos + o.acciones + o.seguros + o.epsvPre + o.epsvPost;
  const patrimonioJubilacion = plan.ini.liq + plan.ini.V + plan.ini.ep.pre + plan.ini.ep.post;
  return {
    disponible: true,
    cfg,
    textos: F.textos(cfg),
    limites: F.limites(cfg),
    entrada: o,
    parametros: {
      escalaGeneral: cfg.parametros.escalaGeneral,
      escalaAhorro: cfg.parametros.escalaAhorro,
      prevision: cfg.parametros.prevision,
      escalaGeneralVisible: F.escalaGeneralVisible(cfg),
      escalaAutonomica: cfg.escalaAutonomica
    },
    plan,
    escenarios,
    base,
    anio1: y1,
    resumen: {
      netoMensual: y1 ? y1.neto / 12 : 0,
      brutoMensual: y1 ? y1.bruto / 12 : 0,
      impuestoMensual: y1 ? y1.impuesto / 12 : 0,
      pensionNetaMensual: y1 ? y1.pensionNeta / 12 : 0,
      restoNetoMensual: y1 ? y1.restoNeto / 12 : 0,
      deflactor1: y1 ? y1.deflactor : 1,
      patrimonioHoy,
      patrimonioJubilacion,
      ratioEpsv: plan.ini.ep.ratio,
      metodoEpsv: plan.ini.ep.metodo
    },
    capital: plan.capital,
    escalasConElIpc: actualiza,
    avisos: avisos(entrada)
  };
}

/* ---------------------------------------------- Piezas sueltas, por territorio --- */

/** La configuración de un territorio, con Bizkaia y la escala de referencia si no se dice otra cosa. */
function configuracionDe(territorio?: string | null, ccaa?: string | null): Configuracion {
  const cfg = F.configuracion(territorio === undefined ? DEFECTO.territorio : territorio, ccaa === undefined ? DEFECTO.ccaa : ccaa);
  if (!cfg) throw new Error(`No se reconoce el territorio «${String(territorio)}».`);
  return cfg;
}

function parametrosVascosDe(territorio?: string): ParametrosVascos {
  const cfg = configuracionDe(territorio);
  if (cfg.modelo !== "vasco") throw new Error(`${cfg.nombre} no sigue el modelo de los territorios históricos vascos.`);
  return cfg.parametros;
}

/** El IRPF de unas rentas en un territorio. Sin territorio, Bizkaia. */
export function irpf(rentas: RentasDelAnio & { territorio?: string; ccaa?: string }): ResultadoDelIrpf {
  return F.irpf(configuracionDe(rentas.territorio, rentas.ccaa), rentas);
}

/** La bonificación del trabajo de los territorios vascos. */
export const bonificacionTrabajo = (trabajo: number, otrasRentas: number, territorio?: string): number => F.bonificacionTrabajo(parametrosVascosDe(territorio), trabajo, otrasRentas);

/** La deducción por edad de los territorios vascos. */
export const deduccionEdad = (edad: number, baseTotal: number, territorio?: string): number => F.deduccionEdad(parametrosVascosDe(territorio), edad, baseTotal);
