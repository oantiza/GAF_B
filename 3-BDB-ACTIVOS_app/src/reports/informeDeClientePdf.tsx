/* eslint-disable react-refresh/only-export-components */
/**
 * El informe de cliente de una propuesta («Informe de cartera», tema cliente): lo que el asesor entrega a su cliente. Sale de la plantilla
 * única de informes (`plantilla/`), con el aspecto del papel de cliente de antes: portada a página completa, la identidad del asesor en
 * la cabecera, «CONFIDENCIAL» y «Página x de N» en cada hoja.
 *
 * El documento vive en `informeDeCliente/`: `datos.ts` prepara lo que se imprime (y las cuentas de presentación que prueban las pruebas),
 * `secciones.tsx` lo escribe con las piezas de la plantilla y `graficos.tsx` dibuja el mapa del mundo, el mapa de riesgo y rentabilidad y la
 * matriz de solapamiento. Este fichero es la puerta: la descarga que usan las pantallas, el `Blob` y lo que otros importan de aquí.
 */
import { Font } from "@react-pdf/renderer";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { loadReportOverlap } from "../core/reportOverlap";
import { DocumentoDeInforme, FUENTE, HojasDeSecciones, refrescarFuentes, renderizarInforme } from "./plantilla";
import { MEDIDOR_ESTIMADO, prepararInforme, type DatosDelInforme, type InformeDeClientePdfInput, type Medidor } from "./informeDeCliente/datos";
import { seccionesDelInforme } from "./informeDeCliente/secciones";

export {
  buildReportGeography,
  cifrasDelMapa,
  COCIENTE_DE_RIESGO_MAXIMO,
  COCIENTE_DE_RIESGO_MINIMO,
  fraseDelRiesgoDeLaReferencia,
  importesQueSuman,
  informeDeClienteMetricRows,
  lineaDelAlcance,
  nombreEnLineas,
  notaDelTipoSinRiesgo,
  pasoDeLaMatriz,
  rentabilidadPorDividendoDe,
  SIGLAS_DE_LAS_CATEGORIAS,
  type CifraDeLaCartera,
  type CifraDelMapa,
  type InformeDeClientePdfInput
} from "./informeDeCliente/datos";
export { BLANCO_DESDE_EL_PASO, COLORES_DE_ZONA, colorDeLaCifra, RAMPA_DE_LA_MATRIZ, rellenoDeLaZona, tintaSobreElPaso, ZONA_SIN_PESO } from "./informeDeCliente/tinta";

/** Lo que el documento dice de sí mismo en la cabecera, en los metadatos y en el nombre del fichero. */
const DOCUMENTO = "Informe de cartera";

function InformeDeClienteDoc({ datos }: { datos: DatosDelInforme }) {
  return (
    <DocumentoDeInforme
      tema="cliente"
      documento={DOCUMENTO}
      titulo={`${DOCUMENTO}${datos.clientName ? ` - ${datos.clientName}` : ""}`}
      asunto="Informe personalizado de cartera"
      identidad={datos.identidad}
      destinatario={datos.clientName || undefined}
    >
      <HojasDeSecciones secciones={seccionesDelInforme(datos)} datos={datos} />
    </DocumentoDeInforme>
  );
}

type FuenteMedible = { layout(texto: string): { advanceWidth: number }; unitsPerEm: number };

/**
 * El ancho de un texto en la letra del papel, con la fuente ya cargada. La matriz y las alturas lo usan para decidir líneas y qué cabe
 * junto. Se toma la fuente cargada una vez: el documento refresca el registro de fuentes al componerse, y la medida de esta no cambia.
 */
async function medidorDelPapel(): Promise<Medidor> {
  try {
    refrescarFuentes();
    await Font.load({ fontFamily: FUENTE.sans, fontWeight: 400 });
    const fuente = Font.getFont({ fontFamily: FUENTE.sans, fontWeight: 400 })?.data as FuenteMedible | null | undefined;
    if (fuente) return (texto, cuerpo) => (fuente.layout(texto).advanceWidth / fuente.unitsPerEm) * cuerpo;
  } catch {
    // Sin la fuente, la estimación por lo alto: mejor una línea de más que un nombre que no cabe.
  }
  return MEDIDOR_ESTIMADO;
}

export async function createInformeDeClientePdfBlob(input: InformeDeClientePdfInput): Promise<Blob> {
  const datos = prepararInforme(input, await medidorDelPapel());
  return renderizarInforme(<InformeDeClienteDoc datos={datos} />);
}

export async function downloadInformeDeClientePdf(input: InformeDeClientePdfInput): Promise<void> {
  const { getAssetDataSource } = await import("../adapters/assetDataSource");
  const { seriesDeReferenciaOAusencia } = await import("../adapters/seriesDeReferencia");
  const { leerIdentidad } = await import("../core/identidadDelAsesor");
  /* El documento se dibuja con todo ya cargado. Si la cartera de referencia no llega, sale igual y dice que no está. */
  const [overlap, referencia] = await Promise.all([
    input.overlap ?? loadReportOverlap(input.report.positions, getAssetDataSource(input.report.mode)),
    input.referencia !== undefined ? input.referencia : seriesDeReferenciaOAusencia()
  ]);
  const blob = await createInformeDeClientePdfBlob({ ...input, overlap, referencia, identidad: input.identidad ?? leerIdentidad() });
  descargar(blob, nombreDelFicheroDelInformeDeCliente(input));
}

/**
 * «Informe de cartera - Familia García - 2026-11-14.pdf»: el documento, el cliente (o la propuesta, si no hay cliente) y el día que
 * imprime la presentación, el de quien lo genera.
 */
export function nombreDelFicheroDelInformeDeCliente(input: Pick<InformeDeClientePdfInput, "clientName" | "report" | "generadoEn">): string {
  return nombreDelFichero({
    documento: DOCUMENTO,
    de: input.clientName?.trim() || input.report.portfolio_name?.trim() || null,
    fecha: diaDelDocumento(input.generadoEn)
  });
}
