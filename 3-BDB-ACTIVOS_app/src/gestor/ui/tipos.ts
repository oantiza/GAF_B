/**
 * Lo que recibe cada vista de una cartera abierta. Las vistas no cargan datos ni calculan:
 * leen de aquí y piden cambios por `abierta.cambiar`.
 */
import type { AlmacenDeCarteras } from "../almacen/almacen";
import type { Analisis, PeriodoHabitual, Preparado } from "../motor/analisis";
import type { Dia } from "../motor/fechas";
import type { Movimiento } from "../motor/modelo";
import type { Periodo } from "../motor/rentabilidad";
import type { VistaDelAnalisis } from "./direccion";
import type { MercadoDeCartera, PeriodoElegido } from "./estado/useAnalisisDeCartera";
import type { CarteraAbierta } from "./estado/useCarteraAbierta";

export type VistaDeLaCartera = "resumen" | "cuentas" | "movimientos" | "analisis" | "comparar";

export interface DatosDeVista {
  abierta: CarteraAbierta;
  /** El análisis del periodo elegido, a la fecha de hoy. */
  analisis: Analisis;
  preparado: Preparado;
  periodos: PeriodoHabitual[];
  periodo: Periodo;
  elegido: PeriodoElegido;
  /** Si el periodo elegido no se podía dar (fechas que no forman un periodo, o sin historia) y se enseña «desde el inicio». */
  periodoCaido?: boolean;
  /** El día de hoy: el último día que se valora. */
  hoy: Dia;
  mercado: MercadoDeCartera;
  /** La carpeta de carteras, si la hay: para comparar con otras carteras guardadas. */
  almacen: AlmacenDeCarteras | null;
  /** Cambia de pestaña; en «Análisis», con la vista que se dé ya elegida. */
  irA(vista: VistaDeLaCartera, vistaDelAnalisis?: VistaDelAnalisis): void;
  /** Abre el formulario para un movimiento nuevo, con los campos que se den ya rellenos. */
  nuevoMovimiento(inicial?: Partial<Movimiento>): void;
  editarMovimiento(movimiento: Movimiento): void;
}
