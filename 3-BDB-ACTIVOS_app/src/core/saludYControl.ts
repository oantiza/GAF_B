import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { ClaseDeAusencia } from "../types/fichaInstrumento";
import { CONCENTRATION_THRESHOLDS, concentrationBand } from "./concentration";
import { oFalta, peso, porcentaje } from "./formato";
import { textoEnPantalla } from "./glosarioDePantalla";
import {
  conTramosEstimados,
  fueraDeLaMedida,
  aportacionAlRiesgo,
  hayCifraDeCartera,
  MIDIENDO,
  PESO_MINIMO_MEDIDO_PCT,
  pesoLegible,
  rotuloDeLaMedida,
  type FueraDeLaMedida
} from "./medidaDeLaCartera";
import type { PortfolioFeasibilityCheck } from "./portfolioConstraints";
import {
  PORTFOLIO_HEALTH_RULES,
  pesoMedidoPorActivo,
  type PesoMedido,
  type PortfolioHealthResult,
  type PortfolioHealthViolation
} from "./portfolioHealth";
import { riesgoMedidoDe } from "./riesgoMedido";

/**
 * La sección «Salud y control» de Análisis. Decisión 18 de Óscar (04-11-2026): hechos sin adjetivo.
 *
 * Había una tarjeta que decía «Cartera saludable» y un monitor con cinco filas y cuatro escalas (A, OK,
 * Baja, Alta), con los umbrales sin ver y al lado de un 12 % fuera del cálculo. Aquí queda una sola
 * lectura: lo que se ha medido, lo que se ha quedado fuera, cuántas alertas hay, y cada fila con su cifra
 * y su umbral.
 *
 * El informe interno lee esta misma lectura desde el 05-11-2026: lo que dice la pantalla y lo que dice el papel
 * del asesor no pueden separarse. `portfolioHealth.ts` tiene las reglas y los umbrales; esto los lee y escribe sus
 * propias palabras. Los umbrales de 25 % y 40 % no se mueven.
 */

const UMBRAL_DE_APORTACION = PORTFOLIO_HEALTH_RULES.RISK_CONTRIBUTION_WARN_PCT;

/** Lo que mira de verdad la comprobación de restricciones con los límites por defecto. */
const LO_QUE_MIRAN_LAS_RESTRICCIONES = "Que los pesos sumen 100 % y que cada activo exista y sea invertible.";

export type EstadoDeSalud = "midiendo" | "sin-alertas" | "con-alertas" | "a-revisar";

export interface AlertaDeSalud {
  clave: string;
  /** «Crítico» por encima del límite alto; «Revisar» en lo demás. */
  palabra: "Crítico" | "Revisar";
  texto: string;
  umbral: string;
}

export interface FilaDeControl {
  rotulo: string;
  /** La cifra escrita. Sin ella, `ausencia` dice qué clase de hueco es. */
  cifra?: string;
  ausencia?: ClaseDeAusencia;
  /** El umbral a la vista, o de qué es la cifra. */
  nota?: string;
  /** Se pinta «Revisar» en terracota al lado de la cifra. Solo cuando toca. */
  revisar: boolean;
  /** Lo concreto que hay que revisar, si son varias cosas. */
  detalle?: string[];
  /**
   * Se pinta «Revisar» y no sale en la lista de alertas: el titular tiene que contarla. Las de la mayor posición
   * y la mayor aportación ya están allí con su nombre.
   */
  cuentaEnElTitular?: boolean;
}

export interface LecturaDeSalud {
  estado: EstadoDeSalud;
  titular: string;
  porQue?: string;
  fuera: FueraDeLaMedida[];
  alertas: AlertaDeSalud[];
  filas: FilaDeControl[];
}

export interface EntradaDeSalud {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  feasibility: PortfolioFeasibilityCheck | null;
  /** La regla de salud ya evaluada, con la contribución que trae la medición. */
  salud: PortfolioHealthResult;
  /** La simulación del periodo elegido; `null` si aún no ha llegado o ha fallado. */
  horizonte: PortfolioHorizon | null | undefined;
  midiendo: boolean;
  /** La simulación ha fallado, que no es lo mismo que no poder hacerla: reintentándola puede volver. */
  medicionFallida?: boolean;
  /** Los datos no dan para simular: el servidor lo ha dicho, y reintentar no lo arregla. */
  sinSerie?: boolean;
}

function umbralDe(violacion: PortfolioHealthViolation): string {
  switch (violacion.rule) {
    case "POSITION_WEIGHT":
      return violacion.severity === "FAIL"
        ? `Crítico si una posición pesa más del ${PORTFOLIO_HEALTH_RULES.POSITION_FAIL_WEIGHT_PCT} %`
        : `Aviso si una posición pesa más del ${PORTFOLIO_HEALTH_RULES.POSITION_WARN_WEIGHT_PCT} %`;
    case "RISK_CONTRIBUTION":
      return `Aviso si una posición aporta más del ${UMBRAL_DE_APORTACION} % del riesgo`;
    case "MISSING_RISK_METRICS":
      return `Aviso si falta riesgo en más del ${PORTFOLIO_HEALTH_RULES.MISSING_RISK_WEIGHT_WARN_PCT} % del peso`;
    case "WEIGHT_SUM":
      return `Aviso si no suman ${PORTFOLIO_HEALTH_RULES.WEIGHT_SUM_TARGET_PCT} % ± ${oFalta(porcentaje(PORTFOLIO_HEALTH_RULES.WEIGHT_SUM_TOLERANCE_PCT / 100))}`;
    default:
      return violacion.threshold;
  }
}

function alertasDe(salud: PortfolioHealthResult, horizonte: PortfolioHorizon | null | undefined): AlertaDeSalud[] {
  return salud.violations
    /* «Sin medir» no es una alerta entre otras: cambia lo que se puede afirmar, y va en el titular. */
    .filter((violacion) => violacion.rule !== "RISK_NOT_MEASURED")
    .map((violacion, indice) => {
      const aportacion =
        violacion.rule === "RISK_CONTRIBUTION"
          ? aportacionAlRiesgo(horizonte)?.find((item) => item.asset_id === violacion.asset_id)
          : undefined;
      return {
        clave: `${violacion.rule}-${violacion.asset_id ?? "cartera"}-${indice}`,
        palabra: violacion.severity === "FAIL" ? "Crítico" : "Revisar",
        /* El peso de una aportación es de la parte medida, no de la cartera: dicho así no choca con la
           tabla de al lado cuando algo se queda fuera de la serie. */
        texto: aportacion
          ? `${violacion.message.replace(/\.$/, "")} con ${oFalta(peso(aportacion.weight_pct / 100))} de la parte medida${conTramosEstimados(horizonte) ? " · estimado" : ""}.`
          : violacion.message,
        umbral: umbralDe(violacion)
      };
    });
}

const contar = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

/** Todo lo que se pinta «Revisar» cuenta: «Sin alertas» encima de una fila en «Revisar» se contradecía. */
export function cuantasAlertas({ alertas, filas }: Pick<LecturaDeSalud, "alertas" | "filas">): number {
  return alertas.length + filas.filter((fila) => fila.cuentaEnElTitular).length;
}

function filaDeLaMayorPosicion(mayor: PesoMedido, cuadra: boolean): FilaDeControl {
  const { watch, high } = CONCENTRATION_THRESHOLDS;
  const pesoPct = mayor.medido;
  const banda = concentrationBand(pesoPct);
  /* Las fronteras exactas no disparan: una posición al 25 % justo está equilibrada, y ahí «vigilar desde
     25 %» sería falso. */
  const nota =
    banda === "HIGH"
      ? `crítico: pasa del ${high} %`
      : banda === "WATCH"
        ? `vigilar: pasa del ${watch} %; crítico si pasa del ${high} %`
        : pesoPct < watch
          ? `vigilar desde ${watch} %`
          : `vigilar si pasa del ${watch} %`;
  /* A-164: si la suma no cuadra, la cifra es lo que pesa sobre lo asignado, y la nota dice el peso escrito. */
  const escrito = cuadra ? "" : `${oFalta(peso(mayor.escrito / 100))} escrito, sobre lo asignado; `;
  return { rotulo: "Mayor posición", cifra: oFalta(peso(pesoPct / 100)), nota: `${escrito}${nota}`, revisar: banda !== "BALANCED" };
}

function filaDeLaAportacion(entrada: EntradaDeSalud): FilaDeControl {
  const { horizonte, midiendo, assets } = entrada;
  const rotulo = `Mayor aportación al riesgo${conTramosEstimados(horizonte) ? " · estimado" : ""}`;
  const aportaciones = aportacionAlRiesgo(horizonte);
  if (aportaciones?.length) {
    const mayor = aportaciones.reduce((max, item) => (item.risk_pct > max.risk_pct ? item : max));
    const nombre = assets.find((a) => a.asset_id === mayor.asset_id)?.display_name ?? mayor.asset_id;
    return {
      rotulo,
      cifra: oFalta(peso(mayor.risk_pct / 100)),
      nota: `${nombre}, con ${oFalta(peso(mayor.weight_pct / 100))} de la parte medida; aviso si pasa del ${UMBRAL_DE_APORTACION} %`,
      revisar: mayor.risk_pct > UMBRAL_DE_APORTACION
    };
  }
  if (midiendo && !horizonte) return { rotulo, cifra: MIDIENDO, revisar: false };
  if (horizonte && (horizonte.backtest.asset_ids ?? []).length < 2) {
    return { rotulo, ausencia: "no-aplica", nota: "Con un solo activo medido no hay reparto del riesgo.", revisar: false };
  }
  return {
    rotulo,
    ausencia: "falta",
    nota: horizonte?.frontierUnavailableReason ?? "La medición no ha traído el reparto del riesgo.",
    revisar: false
  };
}

const hayPeso = (positions: readonly BdbManualPortfolioPosition[]) => positions.some((posicion) => (posicion.weight_percent || 0) > 0);

/** Por qué falta la volatilidad de la cartera. Una media de volatilidades no lo es: ignora las correlaciones (decisión 36). */
function motivoSinVolatilidad({ horizonte, medicionFallida, sinSerie, positions }: EntradaDeSalud): string {
  if (horizonte) {
    return hayCifraDeCartera(horizonte.coverageWeightPercent)
      ? "La simulación no ha podido calcularla."
      : `La simulación mide el ${pesoLegible(horizonte.coverageWeightPercent)} del peso; hace falta al menos el ${PESO_MINIMO_MEDIDO_PCT} %.`;
  }
  if (!hayPeso(positions)) return "Ninguna posición tiene peso.";
  if (sinSerie) return `Con los datos de hoy, la simulación no mide ninguna posición; hace falta al menos el ${PESO_MINIMO_MEDIDO_PCT} % del peso.`;
  return medicionFallida ? "La simulación ha fallado: se puede reintentar." : "No se ha podido simular la cartera.";
}

function filaDeLaVolatilidad(entrada: EntradaDeSalud): FilaDeControl {
  const medido = riesgoMedidoDe(entrada.horizonte);
  if (medido && entrada.horizonte) {
    return { rotulo: rotuloDeLaMedida("Volatilidad", entrada.horizonte.years, conTramosEstimados(entrada.horizonte)), cifra: oFalta(porcentaje(medido.volatility)), revisar: false };
  }
  if (entrada.midiendo && !entrada.horizonte) return { rotulo: "Volatilidad", cifra: MIDIENDO, revisar: false };
  return { rotulo: "Volatilidad", ausencia: "falta", nota: motivoSinVolatilidad(entrada), revisar: false };
}

function filaDeLoMedido(entrada: EntradaDeSalud): FilaDeControl {
  const rotulo = "Peso medido";
  const { horizonte, midiendo, medicionFallida, sinSerie, positions } = entrada;
  if (horizonte) {
    const peso = horizonte.coverageWeightPercent;
    /* Medido no es observado: de una posición con tramo estimado, parte de sus días salen de su referencia. */
    const umbral = `a revisar por debajo del ${PESO_MINIMO_MEDIDO_PCT} %${conTramosEstimados(horizonte) ? "; incluye tramos estimados" : ""}`;
    return {
      rotulo,
      cifra: pesoLegible(peso),
      /* La calidad de los datos se cuenta aquí, en peso fuera del cálculo (decisión 18). */
      nota: peso < 99.95 ? `${pesoLegible(100 - peso)} fuera del cálculo; ${umbral}` : umbral,
      revisar: !hayCifraDeCartera(peso)
    };
  }
  if (midiendo) return { rotulo, cifra: MIDIENDO, revisar: false };
  if (sinSerie) {
    return { rotulo, cifra: pesoLegible(0), nota: `Toda la cartera fuera del cálculo; a revisar por debajo del ${PESO_MINIMO_MEDIDO_PCT} %`, revisar: true };
  }
  return {
    rotulo,
    ausencia: "falta",
    nota: !hayPeso(positions)
      ? "Ninguna posición tiene peso."
      : medicionFallida
        ? "La simulación ha fallado: se puede reintentar."
        : "No se ha podido simular la cartera.",
    revisar: true
  };
}

function filaDeLasRestricciones(feasibility: PortfolioFeasibilityCheck | null): FilaDeControl {
  const rotulo = "Restricciones";
  if (!feasibility) return { rotulo, ausencia: "falta", nota: LO_QUE_MIRAN_LAS_RESTRICCIONES, revisar: false };
  if (feasibility.status === "FEASIBLE") {
    return { rotulo, cifra: "Se cumplen", nota: LO_QUE_MIRAN_LAS_RESTRICCIONES, revisar: false };
  }
  const problemas = [...feasibility.blocking_issues, ...feasibility.warnings];
  return {
    rotulo,
    cifra: feasibility.status === "BLOCKED"
      ? contar(feasibility.blocking_issues.length, "bloqueo", "bloqueos")
      : contar(feasibility.warnings.length, "aviso", "avisos"),
    nota: LO_QUE_MIRAN_LAS_RESTRICCIONES,
    revisar: true,
    cuentaEnElTitular: true,
    /* El núcleo lo escribe para el papel; aquí se dice como en el resto de la pantalla. */
    detalle: problemas.slice(0, 5).map((problema) => textoEnPantalla(problema.message))
  };
}

export function leerSaludYControl(entrada: EntradaDeSalud): LecturaDeSalud {
  const { positions, assets, feasibility, salud, horizonte, midiendo, medicionFallida, sinSerie } = entrada;
  const fuera = fueraDeLaMedida(horizonte, positions, assets);
  const alertas = alertasDe(salud, horizonte);
  const medido = riesgoMedidoDe(horizonte);

  /* El mismo peso que lee la regla de los umbrales (`pesoMedidoPorActivo`, decisión A-164): el escrito si la suma
     cuadra y, si no, lo que pesa sobre lo asignado. La fila y la alerta dicen lo mismo. */
  const medidos = pesoMedidoPorActivo(positions);
  const mayor = [...medidos.pesos.values()].reduce<PesoMedido>((max, p) => (p.medido > max.medido ? p : max), { escrito: 0, medido: 0 });
  /* Una posición a 0 no reparte nada: «2 clases» encima de «Renta variable 100 %» no diversifica. */
  const clases = new Set(
    positions
      .filter((p) => (p.weight_percent || 0) > 0)
      .map((p) => assets.find((a) => a.asset_id === p.asset_id)?.economic_asset_class)
      .filter(Boolean)
  ).size;

  const filas: FilaDeControl[] = [
    filaDeLaMayorPosicion(mayor, medidos.cuadra),
    filaDeLaAportacion(entrada),
    {
      rotulo: "Diversificación",
      cifra: `${contar(clases, "clase", "clases")} · ${contar(positions.length, "posición", "posiciones")}`,
      nota: clases < 2 ? "vigilar con menos de 2 clases" : undefined,
      revisar: clases < 2,
      cuentaEnElTitular: clases < 2
    },
    filaDeLaVolatilidad(entrada),
    filaDeLoMedido(entrada),
    filaDeLasRestricciones(feasibility)
  ];

  const totalDeAlertas = cuantasAlertas({ alertas, filas });
  const hayAlertas = totalDeAlertas > 0;
  const cuantas = contar(totalDeAlertas, "alerta", "alertas");

  if (midiendo && !horizonte) {
    return hayAlertas
      ? { estado: "con-alertas", titular: `${cuantas} · midiendo el riesgo`, fuera, alertas, filas }
      : { estado: "midiendo", titular: "Midiendo el riesgo", porQue: "La simulación con series tarda unos segundos.", fuera, alertas, filas };
  }
  if (horizonte && !medido) {
    return hayCifraDeCartera(horizonte.coverageWeightPercent)
      ? { estado: "a-revisar", titular: "A revisar · la simulación no ha dado todas sus cifras", porQue: motivoSinVolatilidad(entrada), fuera, alertas, filas }
      : {
          estado: "a-revisar",
          titular: `A revisar · solo se ha medido el ${pesoLegible(horizonte.coverageWeightPercent)} del peso`,
          porQue: `Por debajo del ${PESO_MINIMO_MEDIDO_PCT} % del peso, el riesgo de la cartera no se da por medido.`,
          fuera,
          alertas,
          filas
        };
  }
  if (!horizonte) {
    return {
      estado: "a-revisar",
      titular: sinSerie
        ? "A revisar · no se ha medido ninguna posición"
        : medicionFallida
          ? "A revisar · la simulación ha fallado"
          : "A revisar · el riesgo de la cartera no está medido",
      porQue: sinSerie
        ? `Con los datos de hoy, la simulación no mide ninguna posición, y por debajo del ${PESO_MINIMO_MEDIDO_PCT} % del peso el riesgo de la cartera no se da por medido.`
        : medicionFallida
          ? "Es un fallo al calcularla, no de los datos: se puede reintentar."
          : motivoSinVolatilidad(entrada),
      fuera,
      alertas,
      filas
    };
  }
  return {
    estado: hayAlertas ? "con-alertas" : "sin-alertas",
    titular: `${hayAlertas ? cuantas : "Sin alertas"} en lo medido · ${pesoLegible(horizonte.coverageWeightPercent)} del peso`,
    fuera,
    alertas,
    filas
  };
}
