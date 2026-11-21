/* eslint-disable react-refresh/only-export-components */
/**
 * «Frente a su referencia»: la cartera y su referencia (un índice, una cartera de referencia o la
 * liquidez) en base 100, la rentabilidad de cada una y la diferencia, con qué es la referencia
 * dicho en llano. Si la cartera tiene referencia y en este periodo no se puede comparar —le faltan datos o va atrasada—, la
 * sección sale igual y dice por qué en una línea (decisión A-197, 20-11-2026): hasta entonces desaparecía sin decirlo.
 */
import { numero, puntos, rentabilidad, signoDe } from "../../../../core/formato";
import { GraficoDeLineas, Nota, Parrafo, Tabla, type CeldaDeTabla, type FilaDeTabla } from "../../../../reports/plantilla";
import { metrica } from "../../../motor/metricas/registro";
import { descripcionDeLaReferencia, notaDeLosPesos } from "../../../motor/referencia";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { LoContadoComoCero, Pequena } from "../piezas";

/** Una rentabilidad con su signo y su color; si falta, su frase. */
const conSigno = (valor: number | null | undefined): CeldaDeTabla => ({ texto: rentabilidad(valor), signo: signoDe(valor, 4) });

/** Con referencia y sin poder compararla: qué es, y por qué no se compara en este periodo. Sin cifras que no se pueden dar. */
function NoSeCompara({ datos }: { datos: DatosDelInforme }) {
  const { analisis, cartera } = datos;
  const nombre = analisis.referencia?.nombre ?? cartera.referencia?.nombre ?? "";
  const motivo = analisis.referencia?.motivo ?? "No se dispone de sus datos para este periodo.";
  return (
    <>
      <Parrafo>{`La referencia de esta cartera es ${nombre}. En este periodo no se puede comparar con ella. ${motivo}`}</Parrafo>
      <Nota>Para comparar dos rentabilidades hace falta que la referencia tenga datos al día y sin huecos largos en todo el periodo. Cuando los tenga, este informe la comparará.</Nota>
    </>
  );
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis, cartera } = datos;
  if (analisis.referencia?.disponible !== true) return <NoSeCompara datos={datos} />;
  const referencia = analisis.referencia;
  const queEs = cartera.referencia ? [descripcionDeLaReferencia(cartera.referencia), notaDeLosPesos(cartera.referencia)].filter(Boolean).join(" ") : "";
  const r = analisis.rentabilidad!;
  const anual = r.anualiza;
  const diferencia = referencia.diferencia;
  const enPuntos = diferencia === null ? "" : `${numero(Math.abs(diferencia) * 100, { decimales: 2 }) ?? ""} puntos porcentuales`;
  const frase = diferencia === null
    ? ""
    : signoDe(diferencia, 4) === "sube"
      ? `En este periodo la cartera ha rendido ${enPuntos} más que su referencia.`
      : signoDe(diferencia, 4) === "baja"
        ? `En este periodo la cartera ha rendido ${enPuntos} menos que su referencia.`
        : "En este periodo la cartera ha rendido lo mismo que su referencia.";
  const columnas = [{ titulo: "", ancho: anual ? 52 : 70 }, { titulo: "En el periodo", ancho: anual ? 24 : 30, cifra: true }, ...(anual ? [{ titulo: "Anualizada", ancho: 24, cifra: true }] : [])];
  const fila = (nombre: string, acumulada: number | null, porAnio: number | null): FilaDeTabla => ({ celdas: [nombre, conSigno(acumulada), ...(anual ? [conSigno(porAnio)] : [])] });
  return (
    <>
      <Parrafo>{`Se compara con ${referencia.nombre}.${queEs ? ` ${queEs}` : ""} ${metrica("diferenciaConLaReferencia").ayuda}`}</Parrafo>
      <GraficoDeLineas
        fechas={analisis.serie.map((punto) => punto.fecha)}
        series={[
          { nombre: "Su cartera", valores: analisis.serie.map((punto) => punto.valor) },
          { nombre: referencia.nombre, valores: referencia.serie.map((punto) => punto.valor), referencia: true }
        ]}
        formato={(valor) => numero(valor, { decimales: 1 })}
        alto={170}
      />
      <Pequena>{"Las dos líneas parten de 100 al inicio del periodo: si una llega a 110, ha ganado un 10\u00a0%. Así se ven juntas aunque valgan cosas distintas."}</Pequena>
      <Tabla
        columnas={columnas}
        filas={[fila("Su cartera", r.twr, r.twrAnualizada), fila(referencia.nombre, referencia.rentabilidad, referencia.rentabilidadAnualizada)]}
        total={["Diferencia", { texto: puntos(diferencia), signo: signoDe(diferencia, 4) }, ...(anual ? [""] : [])]}
      />
      {frase ? <Parrafo>{frase}</Parrafo> : null}
      <LoContadoComoCero analisis={analisis} />
      <Nota>Una referencia no paga comisiones ni impuestos y no recibe aportaciones ni retiradas; la cartera sí. Por eso se compara con la rentabilidad de la cartera, y la comparación sirve de orientación, no de examen.</Nota>
    </>
  );
}

export const referencia: SeccionDeInforme = {
  id: "referencia",
  titulo: "Frente a su referencia",
  juntoAlTitulo: 230,
  procede: (datos) => hayCifras(datos) && (datos.analisis.referencia !== undefined || datos.cartera.referencia !== undefined) && datos.analisis.serie.length > 1,
  Contenido
};
