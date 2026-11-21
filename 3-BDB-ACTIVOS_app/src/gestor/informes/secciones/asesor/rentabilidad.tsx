/* eslint-disable react-refresh/only-export-components */
/**
 * Rentabilidad y riesgo: TWR y TIR del periodo, el desglose del resultado, volatilidad, caída
 * máxima con sus fechas, Sharpe con su tipo libre de riesgo, Sortino y Calmar, el último año y
 * los últimos 3 y 5 años, la tabla de meses y años y la comparación con la referencia.
 */
import { View } from "@react-pdf/renderer";
import { fecha, importe, numero, porcentaje, puntos, ratio, rentabilidad as conDosDecimalesYSigno, signoDe } from "../../../../core/formato";
import { textoDeAusencia } from "../../../../core/textoDeAusencia";
import { GraficoDeLineas, Tabla, type CeldaDeTabla, type FilaDeTabla } from "../../../../reports/plantilla";
import { metrica } from "../../../motor/metricas/registro";
import { descripcionDeLaReferencia, notaDeLosPesos } from "../../../motor/referencia";
import { notaDeLasCifrasQueLasCuentanComoCero } from "../../../motor/sinPrecio";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras, motivoDeMetrica, tieneValor } from "../comun";
import { Pequena, RejillaConSigno, Subtitulo, TablaDeMeses, type DatoConSigno } from "../piezas";

/** Una rentabilidad con su signo y su color. */
const conSigno = (rotulo: string, valor: number | null | undefined, apunte?: string): DatoConSigno => ({ rotulo, valor: conDosDecimalesYSigno(valor), signo: signoDe(valor, 4), apunte });

/** Las cifras de «Últimos años»: la acumulada de cada horizonte (métrica del registro) y, en 3 y 5 años, su anualizada (de la misma línea del análisis). */
const ULTIMOS_ANIOS: ReadonlyArray<{ anios: number; rotulo: string; acumulada: string }> = [
  { anios: 1, rotulo: "Último año", acumulada: "rentabilidadUltimoAnio" },
  { anios: 3, rotulo: "Últimos 3 años", acumulada: "rentabilidadUltimos3Anios" },
  { anios: 5, rotulo: "Últimos 5 años", acumulada: "rentabilidadUltimos5Anios" }
];

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const r = analisis.rentabilidad!;
  const d = analisis.desglose;
  const riesgo = analisis.riesgo;
  const referencia = analisis.referencia;
  const queEs = datos.cartera.referencia ? [descripcionDeLaReferencia(datos.cartera.referencia), notaDeLosPesos(datos.cartera.referencia)].filter(Boolean).join(" ") : "";
  const sharpe = metrica("sharpe");
  const sortino = metrica("sortino");
  const calmar = metrica("calmar");
  const euros = (valor: number) => importe(valor, { divisa });
  const resultado = (valor: number): CeldaDeTabla => ({ texto: importe(valor, { divisa, conSigno: true }), signo: signoDe(valor, 2) });

  const datosDeRentabilidad: DatoConSigno[] = [
    conSigno("Rentabilidad (TWR), periodo", r.twr),
    r.anualiza ? conSigno("Rentabilidad anualizada (TWR)", r.twrAnualizada) : { rotulo: "Rentabilidad anualizada (TWR)", valor: null, motivo: motivoDeMetrica(metrica("rentabilidadAnualizada"), analisis) },
    r.tir === null ? { rotulo: "Rentabilidad del cliente (TIR), periodo", valor: null, motivo: motivoDeMetrica(metrica("rentabilidadDelCliente"), analisis) } : conSigno("Rentabilidad del cliente (TIR), periodo", r.tir),
    r.tirAnualizada === null
      ? { rotulo: "Rentabilidad anualizada del cliente (TIR)", valor: null, motivo: r.anualiza ? "No se puede calcular con estos flujos." : "El periodo no llega a un año." }
      : conSigno("Rentabilidad anualizada del cliente (TIR)", r.tirAnualizada),
    { rotulo: "Valor inicial", valor: euros(r.valorInicial) },
    { rotulo: "Entradas", valor: euros(r.entradas) },
    { rotulo: "Salidas", valor: euros(r.salidas) },
    { rotulo: "Valor final", valor: euros(r.valorFinal) },
    { rotulo: "Resultado", valor: importe(r.resultado, { divisa, conSigno: true }), signo: signoDe(r.resultado, 2), apunte: `${r.dias} días, del ${fecha(r.desde) ?? r.desde} (cierre) al ${fecha(r.hasta) ?? r.hasta}` }
  ];

  const filasDelDesglose: FilaDeTabla[] = d
    ? [
        { celdas: ["Variación de precio", resultado(d.cuadrado.precio), ""] },
        { celdas: ["Ingresos netos de retención (dividendos, cupones e intereses)", resultado(d.cuadrado.ingresos), importe(d.efectivo.ingresos, { divisa, conSigno: true })] },
        { celdas: ["Efecto divisa", resultado(d.cuadrado.divisa), importe(d.efectivo.divisa, { divisa, conSigno: true })] },
        { celdas: ["Costes e impuestos de la cuenta", resultado(-d.cuadrado.costes), importe(-d.efectivo.costes, { divisa, conSigno: true })] }
      ]
    : [];

  const caida = riesgo?.maximaCaida;
  const datosDeRiesgo: DatoConSigno[] = riesgo && caida
    ? [
        tieneValor(metrica("volatilidad"), analisis)
          ? { rotulo: "Volatilidad anualizada", valor: porcentaje(riesgo.volatilidad), apunte: `${riesgo.semanas} rentabilidades semanales` }
          : { rotulo: "Volatilidad anualizada", valor: null, motivo: motivoDeMetrica(metrica("volatilidad"), analisis) },
        {
          rotulo: "Caída máxima",
          valor: porcentaje(caida.caida),
          apunte: caida.maximo && caida.minimo ? `Del ${fecha(caida.maximo) ?? ""} al ${fecha(caida.minimo) ?? ""} · ${caida.recuperacion ? `recuperada el ${fecha(caida.recuperacion) ?? ""}` : "sin recuperar"}` : "Sin caídas en el periodo"
        },
        tieneValor(sharpe, analisis)
          ? { rotulo: "Ratio de Sharpe", valor: ratio(riesgo.sharpe), apunte: riesgo.libreDeRiesgo ? `€STR medio ${porcentaje(riesgo.libreDeRiesgo.tasa) ?? ""} · cobertura ${porcentaje(riesgo.libreDeRiesgo.cobertura, { decimales: 0 }) ?? ""}` : undefined }
          : { rotulo: "Ratio de Sharpe", valor: null, motivo: motivoDeMetrica(sharpe, analisis) },
        /* Con menos de un año no se anualiza: no es un dato que falte, es que no corresponde, y lleva el mismo motivo que el Sharpe. */
        riesgo.rentabilidadAnualizada === null
          ? { rotulo: "Rentabilidad anualizada del Sharpe", valor: null, motivo: "Hace falta al menos un año de historia." }
          : conSigno("Rentabilidad anualizada del Sharpe", riesgo.rentabilidadAnualizada, "Por fechas (días / 365,2425)"),
        tieneValor(sortino, analisis)
          ? { rotulo: "Ratio de Sortino", valor: ratio(riesgo.sortino), apunte: `Desviación bajista semanal frente al mismo €STR · ${riesgo.semanas} semanas` }
          : { rotulo: "Ratio de Sortino", valor: null, motivo: motivoDeMetrica(sortino, analisis) },
        tieneValor(calmar, analisis)
          ? { rotulo: "Ratio de Calmar", valor: ratio(riesgo.calmar), apunte: "Rentabilidad anualizada del Sharpe / |caída máxima|" }
          : { rotulo: "Ratio de Calmar", valor: null, motivo: motivoDeMetrica(calmar, analisis) }
      ]
    : [];

  /* Último año y últimos 3 y 5 años: de toda la historia hasta la fecha del informe, sin depender del periodo. */
  const datosDeLosUltimosAnios: DatoConSigno[] = ULTIMOS_ANIOS.flatMap(({ anios, rotulo, acumulada }) => {
    const linea = analisis.ultimosAnios.find((candidata) => candidata.anios === anios);
    if (!linea) return [];
    const m = metrica(acumulada);
    if (!tieneValor(m, analisis)) return [{ rotulo, valor: null, motivo: motivoDeMetrica(m, analisis) }];
    const fechas = `Del ${fecha(linea.desde) ?? linea.desde} al ${fecha(linea.hasta) ?? linea.hasta}`;
    return [
      conSigno(rotulo, linea.acumulada, fechas),
      ...(linea.anualizada !== null ? [conSigno(`${rotulo}, anualizada`, linea.anualizada, "Por fechas (días / 365,2425)")] : [])
    ];
  });

  /* Toda la sección sale de la serie del valor: con una posición sin precio se dice arriba, una vez, que la cuenta como
     cero. Vale para la rejilla, el desglose y su suma de contribuciones, el riesgo, los meses y la comparación. */
  const comoCero = notaDeLasCifrasQueLasCuentanComoCero(analisis);

  return (
    <>
      <RejillaConSigno datos={datosDeRentabilidad} columnas={4} />
      {comoCero ? <Pequena>{`${comoCero} Vale para toda esta sección.`}</Pequena> : null}
      {d ? (
        <View wrap={false}>
          <Subtitulo>Desglose del resultado</Subtitulo>
          <Tabla
            columnas={[{ titulo: "Parte", ancho: 285 }, { titulo: "Total (cuadrado al céntimo)", ancho: 115, cifra: true }, { titulo: "De ello, del efectivo", ancho: 115, cifra: true }]}
            filas={filasDelDesglose}
            total={["Resultado", resultado(d.cuadrado.resultado), importe(d.efectivo.resultado, { divisa, conSigno: true })]}
          />
          <Pequena>{`Las comisiones de compra y venta van dentro de la variación de precio. Suma de las contribuciones: ${puntos(d.contribucionTotal) ?? ""} (coincide con la TWR); del efectivo, ${puntos(d.efectivo.contribucion) ?? ""}.`}</Pequena>
        </View>
      ) : null}
      {riesgo ? (
        <View wrap={false}>
          <Subtitulo>Riesgo</Subtitulo>
          <RejillaConSigno datos={datosDeRiesgo} columnas={4} />
        </View>
      ) : null}
      {datosDeLosUltimosAnios.length > 0 ? (
        <View wrap={false}>
          <Subtitulo>{`Últimos años (TWR, toda la historia hasta el ${fecha(analisis.fecha) ?? analisis.fecha})`}</Subtitulo>
          <RejillaConSigno datos={datosDeLosUltimosAnios} columnas={5} />
        </View>
      ) : null}
      {analisis.porMeses.length > 0 ? (
        <>
          <Subtitulo juntoAlTitulo={90}>Rentabilidad por meses y años (TWR, toda la historia)</Subtitulo>
          <TablaDeMeses anios={analisis.porMeses} marcarParciales />
          <Pequena>* Mes o año incompleto: el primero desde el inicio de la cartera, el último hasta la fecha del informe. En blanco, los meses en que la cartera no existía o que no han llegado.</Pequena>
        </>
      ) : null}
      {referencia ? (
        <View wrap={false}>
          <Subtitulo>{`Referencia: ${referencia.nombre}`}</Subtitulo>
          {queEs ? <Pequena>{queEs}</Pequena> : null}
          {referencia.disponible ? (
            <>
              <RejillaConSigno
                columnas={4}
                datos={[
                  conSigno("Referencia, periodo", referencia.rentabilidad),
                  referencia.rentabilidadAnualizada === null ? { rotulo: "Referencia, anualizada", valor: null, motivo: "El periodo no llega a un año." } : conSigno("Referencia, anualizada", referencia.rentabilidadAnualizada),
                  { rotulo: "Diferencia (TWR − referencia)", valor: puntos(referencia.diferencia), signo: signoDe(referencia.diferencia, 4) },
                  {
                    rotulo: "Volatilidad / caída máxima de la referencia",
                    valor: referencia.riesgo ? `${porcentaje(referencia.riesgo.volatilidad) ?? textoDeAusencia("falta")} / ${porcentaje(referencia.riesgo.maximaCaida.caida) ?? textoDeAusencia("falta")}` : null
                  }
                ]}
              />
              <GraficoDeLineas
                fechas={analisis.serie.map((p) => p.fecha)}
                series={[
                  { nombre: "Cartera (TWR)", valores: analisis.serie.map((p) => p.valor) },
                  { nombre: referencia.nombre, valores: referencia.serie.map((p) => p.valor), referencia: true }
                ]}
                formato={(valor) => numero(valor, { decimales: 1 })}
                alto={150}
              />
              <Pequena>Base 100 al cierre inicial del periodo. En azul acero, la cartera (TWR); en gris y a trazos, la referencia, en la divisa base, en los mismos días.</Pequena>
            </>
          ) : (
            <Pequena>{`No se puede comparar: ${referencia.motivo ?? textoDeAusencia("falta")}`}</Pequena>
          )}
        </View>
      ) : null}
    </>
  );
}

export const rentabilidad: SeccionDeInforme = {
  id: "rentabilidad",
  titulo: "Rentabilidad y riesgo",
  comienzo: "nueva",
  procede: hayCifras,
  Contenido
};
