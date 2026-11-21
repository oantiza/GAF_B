import { useMemo, type ReactNode } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import {
  dineroQueSeMueve,
  importeAMover,
  totalesDeCambios,
  type PortfolioOptimizationDiffResult,
  type PortfolioOptimizationDiffRow,
  type PortfolioWeightChange
} from "../core/portfolioOptimizationDiff";
import { importe as escribirImporte, oFalta, peso as escribirPeso, puntos } from "../core/formato";
import type { CeldaDeTabla, ColumnaDeTabla } from "../types/tablaDeDatos";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Cifra } from "./ui/Cifra";
import { KpiStrip, type KpiStripItem } from "./ui/KpiStrip";

/**
 * Los cambios de peso de una propuesta, en un solo sitio.
 *
 * Había tres copias: el diálogo de Optimizar, el de Mejorar cartera y «Cambios aplicados», y cada una llamaba de una
 * forma a lo mismo («Original», «Optimizada», «Después», «Δ peso»). Sus reglas de cifras a la derecha se perdieron en
 * julio, así que nombre e ISIN salían pegados y sin total. Ahora las columnas se llaman igual en las tres, el peso con
 * un decimal y su diferencia en puntos con dos, y siempre salen todas las filas: un total solo cuadra con lo que tiene
 * encima si lo tiene encima.
 *
 * El importe a mover solo existe con el capital fijado: sobre los euros de ejemplo sería una cifra inventada.
 */

const MOVIMIENTO: Record<PortfolioWeightChange, string> = {
  NEW: "Entra",
  REMOVED: "Sale",
  INCREASED: "Sube",
  DECREASED: "Baja",
  UNCHANGED: "Sin cambio"
};

/* Los pesos llegan en puntos (40 es un 40 %): el módulo de formato recibe fracciones. */
const peso = (valor: number) => oFalta(escribirPeso(valor / 100));

/** La diferencia de dos pesos es una resta de porcentajes: va en puntos. Lo que redondea a cero se escribe sin signo. */
const diferencia = (valor: number) => oFalta(puntos(valor / 100));

const importe = (valor: number) => oFalta(escribirImporte(valor, { conSigno: true }));

type FilaDeCambio = PortfolioOptimizationDiffRow & { id: string };

export function CambiosDePeso({
  comparacion,
  capital,
  titulo = "Cambios de peso propuestos"
}: {
  comparacion: PortfolioOptimizationDiffResult;
  /** El capital de la cartera, solo si está fijado. */
  capital?: number;
  titulo?: string;
}) {
  const { rows } = comparacion;
  const filas = useMemo<FilaDeCambio[]>(() => rows.map((row) => ({ ...row, id: row.asset_id })), [rows]);
  const conImporte = typeof capital === "number" && capital > 0;

  const columnas: ColumnaDeTabla<FilaDeCambio>[] = [
    {
      id: "activo",
      titulo: "Activo",
      encabezaFila: true,
      celda: (fila) => ({ texto: fila.label, valor: fila.label, apunte: fila.asset_id })
    },
    {
      id: "movimiento",
      titulo: "Movimiento",
      celda: (fila) => ({ texto: MOVIMIENTO[fila.change], nodo: <span className="tabla__sin-partir">{MOVIMIENTO[fila.change]}</span> })
    },
    { id: "antes", titulo: "Antes", cifra: true, celda: (fila) => ({ texto: peso(fila.before_weight_pct), valor: fila.before_weight_pct }) },
    { id: "propuesta", titulo: "Propuesta", cifra: true, celda: (fila) => ({ texto: peso(fila.after_weight_pct), valor: fila.after_weight_pct }) },
    { id: "diferencia", titulo: "Diferencia", cifra: true, celda: (fila) => ({ texto: diferencia(fila.delta_weight_pct), valor: fila.delta_weight_pct }) },
    ...(conImporte
      ? [
          {
            id: "importe",
            titulo: "Importe a mover",
            cifra: true,
            celda: (fila: FilaDeCambio) => {
              const mover = importeAMover(fila, capital);
              return { texto: importe(mover), valor: mover };
            }
          }
        ]
      : [])
  ];

  const totales = totalesDeCambios(rows);
  const pie = (columna: ColumnaDeTabla<FilaDeCambio>): CeldaDeTabla | undefined => {
    if (columna.id === "antes") return { texto: peso(totales.before_weight_pct) };
    if (columna.id === "propuesta") return { texto: peso(totales.after_weight_pct) };
    if (columna.id === "diferencia") return { texto: diferencia(totales.delta_weight_pct) };
    if (columna.id === "importe" && conImporte) {
      const { compras, ventas, movido } = dineroQueSeMueve(rows, capital);
      return {
        texto: oFalta(escribirImporte(movido)),
        apunte: `Compras ${oFalta(escribirImporte(compras))} · ventas ${oFalta(escribirImporte(ventas))}`
      };
    }
    return undefined;
  };

  return <TablaDeDatos columnas={columnas} deActivos filas={filas} pie={pie} rotuloDelPie="Total" titulo={titulo} />;
}

/**
 * La diferencia de una tasa es una resta de porcentajes, no un porcentaje: va en puntos, «−1,51 pp». Solo la de la
 * rentabilidad lleva el color de su signo: una volatilidad o un coste menores no son una ganancia. La del Sharpe es un
 * ratio, con su signo. Lo que falta lo pinta `Cifra`.
 */
const enPuntos = (valor: number | null | undefined, colorDeSigno = false) => <Cifra tipo="puntos" valor={valor} colorDeSigno={colorDeSigno} />;

const enUnidades = (valor: number | null | undefined) => <Cifra tipo="ratio" valor={valor} conSigno />;

function cifra(label: ReactNode, valor: ReactNode): KpiStripItem {
  return { label, value: valor };
}

/**
 * De dónde salen las tres cifras de riesgo y rentabilidad. La del optimizador es una estimación del modelo; la de
 * Mejorar cartera está medida en la ventana de confirmación. Llamarlas igual sería afirmar lo que no son.
 */
const ROTULOS = {
  modelo: {
    rentabilidad: "Rentabilidad estimada por el modelo",
    volatilidad: "Volatilidad estimada por el modelo",
    sharpe: "Sharpe del modelo"
  },
  confirmacion: {
    rentabilidad: "Rentabilidad en la ventana de confirmación",
    volatilidad: "Volatilidad en la ventana de confirmación",
    sharpe: "Sharpe en la ventana de confirmación"
  }
} as const;

export function CifrasDeLosCambios({
  comparacion,
  medida = "modelo",
  conRetrocesion = false
}: {
  comparacion: PortfolioOptimizationDiffResult;
  medida?: keyof typeof ROTULOS;
  /** La diferencia de retrocesión ponderada, donde tiene sentido decirla. En Modo cliente no sale nunca. */
  conRetrocesion?: boolean;
}) {
  const { seEnsena } = useModoCliente();
  const rotulos = ROTULOS[medida];
  /* Mejorar cartera, una vez aplicada, no trae cifras del modelo: no es que falten, es que esa propuesta no las tiene. */
  const conMetricas = Object.keys(comparacion.before_metrics).length > 0 || Object.keys(comparacion.after_metrics).length > 0;
  const { metric_deltas: deltas } = comparacion;
  return (
    <KpiStrip
      ariaLabel="Diferencia entre la cartera y la propuesta"
      items={[
        ...(conMetricas
          ? [
              cifra(rotulos.rentabilidad, enPuntos(deltas.expected_return, true)),
              cifra(rotulos.volatilidad, enPuntos(deltas.volatility)),
              cifra(rotulos.sharpe, enUnidades(deltas.sharpe))
            ]
          : []),
        cifra("Coste corriente medio", enPuntos(comparacion.delta_weighted_ter_rate)),
        ...(conRetrocesion && seEnsena("retrocesiones")
          ? [cifra("Retrocesión media", enPuntos(comparacion.delta_weighted_retro_pct === null ? null : comparacion.delta_weighted_retro_pct / 100))]
          : [])
      ]}
    />
  );
}
