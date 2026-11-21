/* eslint-disable react-refresh/only-export-components */
/**
 * Posiciones a la fecha, en hoja apaisada: títulos, precio y de dónde sale, valor, peso, coste,
 * resultado latente, resultado del periodo y contribución a la rentabilidad. Y el efectivo.
 *
 * La fila de total suma las filas impresas (valor, peso, coste, resultado del periodo y
 * contribución); el latente total es el del análisis. Una posición sin precio no tiene valor, peso,
 * latente, resultado del periodo ni contribución que dar: sus celdas dicen que falta el dato, y los
 * totales son los de las demás y lo dicen debajo, salvo el del coste, que sí la cuenta (20-11-2026).
 */
import { View } from "@react-pdf/renderer";
import { importe, peso, precio, puntos, rentabilidad, signoDe, titulos } from "../../../../core/formato";
import { type CeldaDeTabla, type ColumnaDeTabla } from "../../../../reports/plantilla";
import { aNumero } from "../../../motor/decimal";
import { NOMBRE_DEL_TIPO_DE_ACTIVO } from "../../../motor/modelo";
import { listaDeLasSinPrecio, notaDeLasSinPrecio } from "../../../motor/sinPrecio";
import { fuenteDelPrecio } from "../../formato";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Pequena, Subtitulo, TablaCompacta } from "../piezas";

const COLUMNAS: ColumnaDeTabla[] = [
  { titulo: "Activo", ancho: 196 },
  { titulo: "Títulos", ancho: 58, cifra: true },
  { titulo: "Precio", ancho: 78, cifra: true },
  { titulo: "Valor", ancho: 74, cifra: true },
  { titulo: "Peso", ancho: 40, cifra: true },
  { titulo: "Coste", ancho: 74, cifra: true },
  { titulo: "Latente", ancho: 70, cifra: true },
  { titulo: "Latente, %", ancho: 50, cifra: true },
  { titulo: "Resultado del periodo", ancho: 74, cifra: true },
  { titulo: "Contribución", ancho: 58, cifra: true }
];

/** «hace 1 día», «hace 12 días», «del día». */
function antiguedad(dias: number): string {
  if (dias <= 0) return "del día";
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const posiciones = analisis.posiciones;
  const conSigno = (valor: number | null): CeldaDeTabla => ({ texto: importe(valor, { divisa, conSigno: true }), signo: signoDe(valor, 2) });
  const filas: CeldaDeTabla[][] = posiciones.map((p) => [
    { texto: p.activo.nombre, apunte: [p.activo.isin ?? p.activo.id, NOMBRE_DEL_TIPO_DE_ACTIVO[p.activo.tipo], p.activo.divisa].join(" · ") },
    titulos(aNumero(p.titulos)),
    /* El precio de un bono es un porcentaje del nominal. Sin precio, la celda lo dice y no hay antigüedad que dar. */
    p.precio === null ? { texto: null, apunte: fuenteDelPrecio(p.fuente) } : { texto: p.activo.bono ? `${precio(p.precio, { divisa: null }) ?? ""}\u00a0%` : precio(p.precio, { divisa: p.activo.divisa }), apunte: `${fuenteDelPrecio(p.fuente)} · ${antiguedad(p.antiguedad)}` },
    importe(p.valor, { divisa }),
    peso(p.peso),
    importe(p.coste, { divisa }),
    conSigno(p.latente),
    { texto: rentabilidad(p.latentePct), signo: signoDe(p.latentePct, 4) },
    conSigno(p.resultadoDelPeriodo),
    { texto: puntos(p.contribucion), signo: signoDe(p.contribucion, 4) }
  ]);
  /* Cada total suma lo que se conoce: una posición sin precio no cuenta en él, y se dice debajo. Si ninguna fila tiene la
     cifra no hay nada que sumar, y el total no se da: un 0,00 € sería una cifra inventada. */
  const suma = (valores: Array<number | null>) => (valores.every((valor) => valor === null) ? null : valores.reduce<number>((a, b) => a + (b ?? 0), 0));
  const noIncluye = notaDeLasSinPrecio(analisis);
  const sinPrecio = analisis.sinPrecio.length;
  /* El del coste es otra regla: es de todas las posiciones, y si a alguna le falta (un tipo de cambio) no se da. */
  const costeTotal = posiciones.some((p) => p.coste === null) ? null : suma(posiciones.map((p) => p.coste));
  const resultadoTotal = suma(posiciones.map((p) => p.resultadoDelPeriodo));
  const contribucionTotal = suma(posiciones.map((p) => p.contribucion));
  const total: CeldaDeTabla[] = [
    `Total posiciones (${posiciones.length})`,
    "",
    "",
    importe(suma(posiciones.map((p) => p.valor)), { divisa }),
    peso(suma(posiciones.map((p) => p.peso))),
    importe(costeTotal, { divisa }),
    conSigno(analisis.latente),
    "",
    conSigno(resultadoTotal),
    { texto: puntos(contribucionTotal), signo: signoDe(contribucionTotal, 4) }
  ];
  const efectivo = analisis.efectivo;
  return (
    <>
      {posiciones.length > 0 ? <TablaCompacta columnas={COLUMNAS} filas={filas} total={total} /> : <Pequena>No hay posiciones abiertas a la fecha.</Pequena>}
      {sinPrecio > 0 ? (
        <Pequena separada>{`${listaDeLasSinPrecio(analisis)} no ${
          sinPrecio === 1
            ? "tiene precio: su valor, su peso, su resultado latente, su resultado del periodo y su contribución no se conocen"
            : "tienen precio: el valor, el peso, el resultado latente, el resultado del periodo y la contribución de cada una no se conocen"
        }. Los totales no ${sinPrecio === 1 ? "la" : "las"} incluyen${costeTotal === null ? "" : `, salvo el del coste, que sí ${sinPrecio === 1 ? "la" : "las"} cuenta`}.`}</Pequena>
      ) : null}
      <Pequena separada>Coste y latente por FIFO, en la divisa base; el latente de un bono incluye el cupón corrido devengado. Resultado del periodo: precio + divisa + ingresos − costes de la posición. Contribución: puntos de la rentabilidad del periodo que aporta cada posición; las del efectivo (intereses, comisiones de la cuenta, divisa) van aparte, en «Rentabilidad y riesgo».</Pequena>
      <View wrap={false}>
        <Subtitulo>Efectivo</Subtitulo>
        {efectivo.porDivisa.length > 0 ? (
          <TablaCompacta
            columnas={[{ titulo: "Divisa", ancho: 80 }, { titulo: "Saldo", ancho: 110, cifra: true }, { titulo: "En tránsito", ancho: 110, cifra: true }, { titulo: `Valor (${divisa})`, ancho: 110, cifra: true }, { titulo: "Peso", ancho: 60, cifra: true }]}
            filas={efectivo.porDivisa.map((linea) => [linea.divisa, importe(aNumero(linea.saldo), { divisa: linea.divisa }), importe(aNumero(linea.enTransito), { divisa: linea.divisa }), importe(linea.valor, { divisa }), ""])}
            total={["Total efectivo", "", importe(efectivo.enTransito, { divisa }), importe(efectivo.total, { divisa }), peso(efectivo.peso)]}
          />
        ) : (
          <Pequena>No hay saldo de efectivo.</Pequena>
        )}
        <Pequena separada>{`Patrimonio a la fecha: ${importe(analisis.patrimonio, { divisa }) ?? ""} (posiciones más efectivo).${noIncluye ? ` ${noIncluye}` : ""}`}</Pequena>
      </View>
    </>
  );
}

export const posiciones: SeccionDeInforme = {
  id: "posiciones",
  titulo: "Posiciones a la fecha",
  apaisada: true,
  procede: (datos) => !datos.analisis.vacia && (datos.analisis.posiciones.length > 0 || datos.analisis.efectivo.porDivisa.length > 0),
  Contenido
};
