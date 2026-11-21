/**
 * Los tipos de los informes del gestor: lo que entra (un `Analisis` y su cartera) y cómo se
 * describe una sección. Este módulo no importa `@react-pdf/renderer` ni la plantilla: solo sus tipos.
 */
import type { SeccionDeInforme as SeccionDeLaPlantilla } from "../../reports/plantilla/secciones";
import type { Analisis } from "../motor/analisis";
import type { Dia } from "../motor/fechas";
import type { Cartera } from "../motor/modelo";

/** El del asesor va con el tema interno de la plantilla; el del cliente y el de costes, con el de cliente. */
export type TipoDeInforme = "asesor" | "cliente" | "costes";

export interface DatosDelInforme {
  analisis: Analisis;
  /** La cartera, para la lista de movimientos del periodo y los nombres de los activos. */
  cartera: Cartera;
  asesor?: { nombre?: string; entidad?: string; contacto?: string; logotipo?: string };
  /** Día en que se genera, «AAAA-MM-DD». */
  generado: string;
}

/**
 * Una sección de un informe: la de la plantilla única (`src/reports/plantilla/secciones.tsx`), con los datos del gestor.
 * La primera de cada informe es la presentación (`comienzo: "presentacion"`); no hay hoja de portada.
 */
export type SeccionDeInforme = SeccionDeLaPlantilla<DatosDelInforme>;

/** Un movimiento de la cartera tal como lo imprime un informe: con nombres y cifras ya en número. */
export interface MovimientoDelInforme {
  id: string;
  fechaOperacion: Dia;
  fechaValor: Dia;
  /** Clave del registro de tipos («compra») y su nombre en pantalla («Compra»). */
  tipo: string;
  operacion: string;
  activoId?: string;
  /** Nombre del activo, o vacío si el movimiento es solo de efectivo. */
  activo: string;
  isin?: string;
  titulos: number | null;
  precio: number | null;
  /** Efecto en la cuenta de efectivo, con signo, en `divisa`. */
  importe: number | null;
  divisa: string;
  comision: number | null;
  gastos: number | null;
  retencion: number | null;
  cuponCorrido: number | null;
  cambio: number | null;
  /** Valor de una operación que no pasa por el efectivo (traspaso, entrada de títulos). */
  valor: number | null;
  /** El otro lado de un traspaso, un canje o un cambio de divisa, en palabras. */
  destino: string;
  nota: string;
  /** «Manual», «Importado» o «Demostración». */
  origen: string;
}
