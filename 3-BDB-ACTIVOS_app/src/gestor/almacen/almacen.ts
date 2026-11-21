/**
 * La interfaz común del almacén de carteras y sus tipos.
 *
 * REQUISITO DE PRODUCTO: las carteras de los clientes se guardan SOLO como ficheros en el
 * disco del usuario. Nunca en Firestore, en un servicio remoto ni en el almacenamiento del
 * navegador. Este módulo y los que lo implementan no conocen la red ni la base.
 */
import type { Cartera } from "../motor/modelo";
import type { CarteraLeida } from "./formato";

export interface ResumenDeCartera {
  /** Nombre del fichero dentro de la carpeta: «Familia García.cartera.json». */
  fichero: string;
  id: string;
  nombre: string;
  divisaBase: string;
  cliente?: string;
  movimientos: number;
  /** Fecha y hora ISO de la última modificación de la cartera. */
  modificada: string;
  /** Si el fichero no se pudo leer: el motivo, en lenguaje llano. Los demás campos van con lo que se sepa. */
  error?: string;
}

export interface CopiaDeSeguridad {
  carteraId: string;
  /** Nombre del fichero de la copia dentro de `copias/<id>/`. */
  fichero: string;
  /** Fecha y hora ISO en que se hizo la copia. */
  fecha: string;
  movimientos?: number;
  bytes: number;
}

export interface AjustesDelGestor {
  asesor?: {
    nombre?: string;
    entidad?: string;
    contacto?: string;
    /** Logotipo como data URL (PNG o JPEG). */
    logotipo?: string;
  };
  /** Campo libre que se conserva. */
  extensiones?: Record<string, unknown>;
}

export interface OpcionesDeGuardado {
  /**
   * Copia lo que se sustituye aunque la última copia sea de hace menos de diez minutos. Para los
   * cambios grandes y destructivos (recuperar una versión, deshacer una importación, borrar,
   * retirar): la versión que se sustituye tiene que quedar en el disco.
   */
  copiaObligada?: boolean;
}

export interface AlmacenDeCarteras {
  clase: "carpeta";
  /** Nombre de la carpeta, para enseñarlo. */
  nombre: string;
  listar(): Promise<ResumenDeCartera[]>;
  /** Abre la cartera y recuerda lo que había en el disco, para no pisarlo si cambia por fuera. */
  abrir(fichero: string): Promise<CarteraLeida>;
  /**
   * Guarda la cartera. Devuelve el nombre del fichero (cambia si la cartera cambió de nombre).
   * Si el fichero ha cambiado en el disco desde que este almacén lo leyó o escribió por última
   * vez (otra pestaña, otro equipo), no escribe: copia lo del disco y falla con `CONFLICTO`.
   */
  guardar(cartera: Cartera, opciones?: OpcionesDeGuardado): Promise<{ fichero: string; copia?: CopiaDeSeguridad }>;
  /** Vuelve a pedir al usuario permiso sobre la carpeta (necesita un gesto suyo). Devuelve si lo dio. */
  pedirPermiso?(): Promise<boolean>;
  /** No borra: mueve el fichero y sus copias a la subcarpeta `papelera/`. */
  retirar(fichero: string): Promise<void>;
  copias(carteraId: string): Promise<CopiaDeSeguridad[]>;
  leerCopia(copia: CopiaDeSeguridad): Promise<CarteraLeida>;
  leerAjustes(): Promise<AjustesDelGestor>;
  guardarAjustes(ajustes: AjustesDelGestor): Promise<void>;
}

export type CodigoDeErrorDeAlmacen =
  /** El navegador no deja leer o escribir en la carpeta (permiso retirado o denegado). */
  | "PERMISO"
  /** La carpeta ya no está donde estaba (movida, borrada o en una unidad desconectada). */
  | "CARPETA_NO_DISPONIBLE"
  /** El fichero pedido no está en la carpeta. */
  | "NO_ENCONTRADO"
  /** La escritura no terminó. El fichero que había sigue intacto. */
  | "ESCRITURA"
  /** Se escribió, pero al releerlo no se pudo abrir. */
  | "VERIFICACION"
  /** El fichero cambió fuera de esta pestaña desde que se leyó: no se escribe para no pisarlo. */
  | "CONFLICTO"
  /** Un fichero auxiliar (ajustes, copia) no se puede leer. */
  | "LECTURA";

/** Un fallo del almacén, con un mensaje en lenguaje llano para enseñarlo tal cual. */
export class ErrorDeAlmacen extends Error {
  readonly codigo: CodigoDeErrorDeAlmacen;

  constructor(codigo: CodigoDeErrorDeAlmacen, mensaje: string, opciones?: { cause?: unknown }) {
    super(mensaje, opciones);
    this.name = "ErrorDeAlmacen";
    this.codigo = codigo;
  }
}
