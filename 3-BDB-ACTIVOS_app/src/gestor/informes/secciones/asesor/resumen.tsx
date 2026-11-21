/* eslint-disable react-refresh/only-export-components */
/**
 * La presentación y el resumen del informe del asesor, en la primera hoja: qué cartera, qué periodo, la ficha (cliente,
 * fechas, divisa, movimientos y quién firma), el estado de la integridad y todas las métricas del registro en una
 * rejilla, cada una con su valor o con el motivo por el que no lo tiene.
 */
import { fechaLarga } from "../../../../core/formato";
import { Aviso, Parrafo, Presentacion, type DatoDeRejilla } from "../../../../reports/plantilla";
import { METRICAS } from "../../../motor/metricas/registro";
import { salvedadParaVariasCifras } from "../../../motor/sinPrecio";
import { periodoEnPalabras } from "../../formato";
import { movimientosDelPeriodo } from "../../movimientos";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { cifraDeMetrica, hayCifras, identidadDe, motivoDeMetrica, nombreDeMetrica, signoDeMetrica } from "../comun";
import { Pequena, RejillaConSigno, Subtitulo, type DatoConSigno } from "../piezas";

const cuenta = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const integridad = analisis.integridad;
  /* Sin cifras en el periodo, ninguna métrica se da: un «0,00 €» de resultado realizado en una cartera vacía no es un dato. */
  const conCifras = hayCifras(datos);
  const metricas: DatoConSigno[] = METRICAS.map((m) => ({
    rotulo: nombreDeMetrica(m),
    valor: conCifras ? cifraDeMetrica(m, analisis) : null,
    motivo: conCifras ? motivoDeMetrica(m, analisis) : m.motivoSinValor?.(analisis) ?? "Sin datos en el periodo.",
    signo: conCifras ? signoDeMetrica(m, analisis) : null
  }));
  /*
   * Lo que hay que saber para leer una cifra que sí tiene valor, dicho bajo la rejilla. Una salvedad que comparten varias
   * cifras se escribe una vez, con todas delante: «Patrimonio y Resultado latente: ninguna incluye Activo B, que no tiene
   * precio.»; «Resultado, Rentabilidad y Volatilidad: cada una cuenta Activo B como cero, porque no tiene precio.»
   */
  const cifrasDeCadaSalvedad = new Map<string, string[]>();
  if (conCifras) {
    for (const m of METRICAS) {
      const salvedad = m.salvedad?.(analisis);
      if (salvedad) cifrasDeCadaSalvedad.set(salvedad, [...(cifrasDeCadaSalvedad.get(salvedad) ?? []), nombreDeMetrica(m)]);
    }
  }
  const salvedades = [...cifrasDeCadaSalvedad].map(([salvedad, cifras]) =>
    cifras.length === 1
      ? `${cifras[0]}: ${salvedad.charAt(0).toLowerCase()}${salvedad.slice(1)}`
      : `${cifras.slice(0, -1).join(", ")} y ${cifras[cifras.length - 1]}: ${salvedadParaVariasCifras(salvedad, analisis)}`
  );
  const ficha: DatoDeRejilla[] = [
    { rotulo: "Cliente", valor: analisis.cartera.cliente ?? "Sin cliente asignado" },
    { rotulo: "Periodo", valor: periodoEnPalabras(analisis) },
    { rotulo: "Datos a", valor: fechaLarga(analisis.fecha) },
    { rotulo: "Generado", valor: fechaLarga(datos.generado) },
    { rotulo: "Divisa base", valor: analisis.cartera.divisaBase },
    { rotulo: "En el periodo", valor: `${movimientosDelPeriodo(datos).length} movimientos · ${analisis.posiciones.length} posiciones abiertas a la fecha` }
  ];
  const { nombre, entidad, contacto } = identidadDe(datos);
  const firma = [nombre, entidad, contacto].map((x) => x?.trim()).filter(Boolean).join(" · ");
  if (firma) ficha.push({ rotulo: "Asesor", valor: firma });
  const estado = integridad.avisos.length === 0
    ? "Integridad: sin avisos. El libro no tiene movimientos sin aplicar, duplicados, descubiertos ni precios dudosos."
    : `Integridad: ${cuenta(integridad.errores, "error", "errores")}, ${cuenta(integridad.advertencias, "aviso", "avisos")} y ${cuenta(integridad.avisos.length - integridad.errores - integridad.advertencias, "nota", "notas")}. El detalle va en «Avisos».`;
  return (
    <>
      <Presentacion contexto={[periodoEnPalabras(analisis), `datos a ${fechaLarga(analisis.fecha) ?? analisis.fecha}`]} titulo={analisis.cartera.nombre} datos={ficha} />
      {integridad.errores > 0 ? <Aviso>{estado}</Aviso> : <Parrafo>{estado}</Parrafo>}
      <Subtitulo>Métricas del registro</Subtitulo>
      <RejillaConSigno datos={metricas} columnas={4} />
      {salvedades.map((salvedad) => (
        <Pequena key={salvedad}>{salvedad}</Pequena>
      ))}
      <Pequena>Rentabilidad: ponderada por tiempo (TWR). Rentabilidad del cliente: ponderada por dinero (TIR), anualizada si el periodo pasa de un año. Volatilidad semanal anualizada (raíz de 52); caída máxima sobre la serie diaria. Sortino: el numerador del Sharpe entre la desviación bajista semanal; Calmar: rentabilidad anualizada entre la caída máxima. Últimos años: toda la historia hasta la fecha, sin depender del periodo.</Pequena>
    </>
  );
}

export const resumen: SeccionDeInforme = {
  id: "resumen",
  titulo: "Resumen",
  comienzo: "presentacion",
  procede: () => true,
  Contenido
};
