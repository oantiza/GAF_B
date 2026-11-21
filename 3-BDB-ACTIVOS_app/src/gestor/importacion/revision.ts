/**
 * La revisión de una importación: lo que pasa entre «el importador propone» y «entra en el
 * libro». Aquí se decide qué activo de la cartera o del catálogo es cada activo que citan
 * los documentos, se marcan los movimientos que ya están en el libro y, cuando el asesor
 * confirma, se aplican. También se deshace una importación entera.
 *
 * Es cálculo puro: recibe la cartera, lo propuesto y el catálogo, y devuelve una cartera nueva.
 */
import { coincideConLoTecleado } from "../../core/busquedaDeActivos";
import { activoDesdeElCatalogo, type ActivoDeCatalogo } from "../mercado/fichas";
import { yaEnElLibro } from "../motor/integridad";
import { contextoDe, validarMovimiento } from "../motor/libro";
import { nuevoId, type Activo, type Cartera, type ExtractoDeclarado, type Importacion, type Movimiento } from "../motor/modelo";
import type { ActivoCitado, MovimientoPropuesto, ResultadoDeImportacion } from "./tipos";

/** Qué se sabe de un activo citado por los documentos. */
export type EstadoDelActivoCitado =
  /** Ya está en la cartera. */
  | "en-cartera"
  /** No está en la cartera, pero el catálogo lo tiene por su ISIN: se dará de alta con sus precios. */
  | "en-catalogo"
  /** Trae ISIN pero el catálogo no lo tiene: se dará de alta como activo propio, con precio a mano. */
  | "nuevo"
  /** Solo trae un nombre: el asesor tiene que decir cuál es. */
  | "por-decidir";

export interface ActivoPorResolver {
  citado: ActivoCitado;
  estado: EstadoDelActivoCitado;
  /** El activo propuesto. En `por-decidir` no hay ninguno hasta que el asesor elige. */
  propuesto?: Activo;
  /** Coincidencias del catálogo por nombre, para elegir. */
  sugerencias: ActivoDeCatalogo[];
  /** En cuántos movimientos propuestos aparece. */
  apariciones: number;
}

/** La decisión del asesor sobre un activo citado: el activo que es, o dejar fuera sus movimientos. */
export type DecisionSobreUnActivo = Activo | "omitir";

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Palabras que no distinguen un fondo de otro: no sirven para buscar. */
const PALABRAS_VACIAS = new Set(["FI", "FCP", "SICAV", "FUND", "FONDO", "CLASE", "CLASS", "ACC", "DIST", "EUR", "USD", "SA", "INC", "PLC", "THE", "DE", "LA", "EL", "A", "B", "C", "I", "R"]);

/** Las coincidencias del catálogo para un nombre: primero con todas sus palabras, y si no hay, con las dos primeras que distinguen. */
export function sugerenciasPorNombre(nombre: string, catalogo: readonly ActivoDeCatalogo[], maximo = 6): ActivoDeCatalogo[] {
  const palabras = plegar(nombre).split(" ").filter((palabra) => palabra.length > 1 && !PALABRAS_VACIAS.has(palabra));
  if (palabras.length === 0) return [];
  for (let cuantas = Math.min(palabras.length, 4); cuantas >= Math.min(2, palabras.length); cuantas -= 1) {
    const busqueda = palabras.slice(0, cuantas).join(" ");
    const encontrados = catalogo.filter((activo) => coincideConLoTecleado({ nombre: activo.nombre, isin: activo.isin, ticker: activo.ticker }, busqueda));
    if (encontrados.length > 0) return encontrados.slice(0, maximo);
  }
  return [];
}

/** Todos los activos que citan unos resultados, sin repetir, con lo mejor que se sabe de cada uno. */
export function activosCitados(resultados: readonly ResultadoDeImportacion[]): Array<{ citado: ActivoCitado; apariciones: number }> {
  const porClave = new Map<string, { citado: ActivoCitado; apariciones: number }>();
  const anotar = (citado: ActivoCitado | undefined, cuenta: boolean): void => {
    if (!citado) return;
    const previo = porClave.get(citado.clave);
    if (!previo) {
      porClave.set(citado.clave, { citado: { ...citado }, apariciones: cuenta ? 1 : 0 });
      return;
    }
    previo.citado = { ...previo.citado, isin: previo.citado.isin ?? citado.isin, divisa: previo.citado.divisa ?? citado.divisa, tipo: previo.citado.tipo ?? citado.tipo, nombre: previo.citado.nombre.length >= citado.nombre.length ? previo.citado.nombre : citado.nombre };
    if (cuenta) previo.apariciones += 1;
  };
  for (const resultado of resultados) {
    for (const propuesto of resultado.movimientos) {
      anotar(propuesto.activo, true);
      anotar(propuesto.destino, true);
    }
    for (const extracto of resultado.extractos) for (const posicion of extracto.posiciones) anotar(posicion.activo, false);
  }
  return [...porClave.values()];
}

/** Qué activo de la cartera o del catálogo es un activo citado. */
export function resolverActivo(citado: ActivoCitado, apariciones: number, cartera: Cartera, catalogo: readonly ActivoDeCatalogo[]): ActivoPorResolver {
  const enCartera =
    cartera.activos.find((activo) => activo.id === citado.clave) ??
    (citado.isin ? cartera.activos.find((activo) => activo.isin === citado.isin) : cartera.activos.find((activo) => plegar(activo.nombre) === plegar(citado.nombre)));
  if (enCartera) return { citado, estado: "en-cartera", propuesto: enCartera, sugerencias: [], apariciones };
  if (citado.isin) {
    const deCatalogo = catalogo.find((activo) => activo.isin === citado.isin);
    if (deCatalogo) return { citado, estado: "en-catalogo", propuesto: activoDesdeElCatalogo(deCatalogo), sugerencias: [], apariciones };
    return {
      citado,
      estado: "nuevo",
      propuesto: { id: citado.isin, isin: citado.isin, nombre: citado.nombre, tipo: citado.tipo ?? "OTRO", divisa: citado.divisa ?? cartera.divisaBase, origen: "manual" },
      sugerencias: sugerenciasPorNombre(citado.nombre, catalogo),
      apariciones
    };
  }
  return { citado, estado: "por-decidir", sugerencias: sugerenciasPorNombre(citado.nombre, catalogo), apariciones };
}

/** Un activo propio (sin catálogo) para un activo citado solo por nombre. */
export function activoPropioPara(citado: ActivoCitado, divisaBase: string): Activo {
  return { id: `propio-${nuevoId().slice(0, 8)}`, nombre: citado.nombre, tipo: citado.tipo ?? "OTRO", divisa: citado.divisa ?? divisaBase, origen: "manual" };
}

export interface LineaDeRevision {
  propuesto: MovimientoPropuesto;
  entidad: string;
  /** El movimiento con sus activos ya sustituidos por los decididos, o `undefined` si falta decidir alguno o se ha omitido. */
  movimiento?: Movimiento;
  /** Errores del motor para ese movimiento: con alguno, no se puede importar tal cual. */
  errores: string[];
  /** Ya hay en el libro un movimiento igual. */
  duplicado: boolean;
  /** Si entra por defecto: válido, sin duplicar y con sus activos decididos. */
  porDefecto: boolean;
  /** Por qué no entra, si no entra. */
  motivo?: string;
}

/**
 * Si una línea es un cargo o un abono que el importador no ha sabido clasificar («Otro cargo o abono», marcado para
 * revisar). Decisión A-156 de Óscar (16-11-2026, hallazgo GES-3): no entra por defecto.
 *
 * Ese tipo cuenta como resultado de la cartera. Un ingreso del cliente rotulado de una forma que el lector no conoce
 * entraba marcado y se convertía en rentabilidad: 20.000 € sin clasificar subían un 9,90 % a un 20,83 %. Fuera, la caja
 * no cuadra con el banco hasta que el asesor diga qué es, y un descuadre se ve.
 *
 * Solo esas líneas. Lo demás que pide revisión —el saldo inicial del extracto, un traspaso sin su pareja— sigue
 * entrando: son apuntes que el libro necesita, con su aviso para comprobarlos.
 */
export function sinClasificar(propuesto: Pick<ResultadoDeImportacion["movimientos"][number], "requiereRevision" | "movimiento">): boolean {
  return propuesto.requiereRevision && propuesto.movimiento.tipo === "otroEfectivo";
}

export interface Revision {
  activos: ActivoPorResolver[];
  lineas: LineaDeRevision[];
  /** Cuántas líneas entran por defecto, cuántas son duplicados y cuántas hay que mirar. */
  listas: number;
  duplicadas: number;
  porRevisar: number;
}

/**
 * La revisión de unos resultados contra una cartera, con las decisiones tomadas hasta ahora.
 * Una decisión que falta se suple con lo propuesto (cartera, catálogo o activo nuevo por ISIN).
 */
export function revisar(resultados: readonly ResultadoDeImportacion[], cartera: Cartera, catalogo: readonly ActivoDeCatalogo[], decisiones: ReadonlyMap<string, DecisionSobreUnActivo> = new Map()): Revision {
  const activos = activosCitados(resultados).map(({ citado, apariciones }) => resolverActivo(citado, apariciones, cartera, catalogo));
  const decidido = new Map<string, DecisionSobreUnActivo | undefined>();
  for (const activo of activos) decidido.set(activo.citado.clave, decisiones.get(activo.citado.clave) ?? activo.propuesto);

  /* La cartera tal como quedaría con los activos decididos, para validar los movimientos contra ella. */
  const conActivos: Cartera = { ...cartera, activos: [...cartera.activos] };
  for (const decision of decidido.values()) {
    if (decision && decision !== "omitir" && !conActivos.activos.some((activo) => activo.id === decision.id)) conActivos.activos.push(decision);
  }
  const contexto = contextoDe(conActivos);

  const lineas: LineaDeRevision[] = [];
  for (const resultado of resultados) {
    for (const propuesto of resultado.movimientos) {
      const linea: LineaDeRevision = { propuesto, entidad: resultado.entidad, errores: [], duplicado: false, porDefecto: false };
      const origen = propuesto.activo ? decidido.get(propuesto.activo.clave) : undefined;
      const destino = propuesto.destino ? decidido.get(propuesto.destino.clave) : undefined;
      if (origen === "omitir" || destino === "omitir") linea.motivo = "Se ha dejado fuera su activo.";
      else if ((propuesto.activo && !origen) || (propuesto.destino && !destino)) linea.motivo = "Falta decir qué activo es.";
      else {
        const movimiento: Movimiento = { ...propuesto.movimiento };
        if (propuesto.activo && origen) movimiento.activoId = origen.id;
        if (propuesto.destino && destino && movimiento.destino) movimiento.destino = { ...movimiento.destino, activoId: destino.id };
        linea.movimiento = movimiento;
        linea.errores = validarMovimiento(movimiento, contexto);
        if (linea.errores.length > 0) linea.motivo = linea.errores[0];
      }
      lineas.push(linea);
    }
  }

  const candidatos = lineas.filter((linea) => linea.movimiento).map((linea) => linea.movimiento!);
  const repetidos = yaEnElLibro(candidatos, cartera.movimientos);
  for (const linea of lineas) {
    linea.duplicado = linea.movimiento !== undefined && repetidos.has(linea.movimiento.id);
    if (linea.duplicado) linea.motivo = "Ya está en el libro.";
    linea.porDefecto = linea.movimiento !== undefined && linea.errores.length === 0 && !linea.duplicado && !sinClasificar(linea.propuesto);
  }
  lineas.sort((a, b) => {
    const fa = a.propuesto.movimiento.fechaOperacion;
    const fb = b.propuesto.movimiento.fechaOperacion;
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  return {
    activos,
    lineas,
    listas: lineas.filter((linea) => linea.porDefecto).length,
    duplicadas: lineas.filter((linea) => linea.duplicado).length,
    porRevisar: lineas.filter((linea) => !linea.porDefecto && !linea.duplicado).length
  };
}

export interface ImportacionAplicada {
  cartera: Cartera;
  importacion: Importacion;
}

/**
 * Aplica a la cartera los movimientos elegidos de una revisión: da de alta los activos que
 * hagan falta, añade los movimientos con identificador definitivo y la marca de la
 * importación, y guarda lo que los extractos declaran para conciliar.
 */
export function aplicarImportacion(
  cartera: Cartera,
  resultados: readonly ResultadoDeImportacion[],
  revision: Revision,
  elegidas: ReadonlySet<string>,
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo> = new Map(),
  ahora: string = new Date().toISOString()
): ImportacionAplicada {
  const importacion: Importacion = {
    id: nuevoId(),
    fecha: ahora,
    entidad: [...new Set(resultados.map((resultado) => resultado.entidad))].join(" y "),
    documentos: resultados.flatMap((resultado) => resultado.documentos.map((documento) => ({ nombre: documento.nombre, tipo: documento.etiqueta }))),
    movimientos: 0
  };
  const activos = [...cartera.activos];
  const anadir = (activo: Activo): void => {
    if (!activos.some((existente) => existente.id === activo.id)) activos.push(activo);
  };
  const decididoPara = (clave: string): Activo | undefined => {
    const decision = decisiones.get(clave) ?? revision.activos.find((activo) => activo.citado.clave === clave)?.propuesto;
    return decision && decision !== "omitir" ? decision : undefined;
  };

  const movimientos = [...cartera.movimientos];
  for (const linea of revision.lineas) {
    if (!linea.movimiento || linea.errores.length > 0 || !elegidas.has(linea.propuesto.movimiento.id)) continue;
    const movimiento: Movimiento = {
      ...linea.movimiento,
      id: nuevoId(),
      origen: { via: "importado", importacionId: importacion.id, documento: linea.propuesto.documento, fila: linea.propuesto.fila, textoOriginal: linea.propuesto.textoOriginal }
    };
    for (const clave of [linea.propuesto.activo?.clave, linea.propuesto.destino?.clave]) {
      const activo = clave ? decididoPara(clave) : undefined;
      if (activo) anadir(activo);
    }
    movimientos.push(movimiento);
    importacion.movimientos += 1;
  }

  const extractos: ExtractoDeclarado[] = [...cartera.extractos];
  for (const resultado of resultados) {
    for (const extracto of resultado.extractos) {
      extractos.push({
        id: nuevoId(),
        fecha: extracto.fecha,
        entidad: resultado.entidad,
        documento: extracto.documento,
        importacionId: importacion.id,
        posiciones: extracto.posiciones.map((posicion) => {
          const activo = decididoPara(posicion.activo.clave);
          return { activoId: activo && activos.some((existente) => existente.id === activo.id) ? activo.id : undefined, isin: posicion.activo.isin, nombre: posicion.activo.nombre, titulos: posicion.titulos, valor: posicion.valor, ...(posicion.fecha ? { fecha: posicion.fecha } : {}) };
        }),
        efectivo: extracto.efectivo
      });
    }
  }

  return {
    cartera: { ...cartera, activos, movimientos, extractos, importaciones: [...cartera.importaciones, importacion], modificada: ahora },
    importacion
  };
}

/** Quita de la cartera todo lo que entró con una importación: sus movimientos, sus extractos y los activos que dejan de usarse. */
export function deshacerImportacion(cartera: Cartera, importacionId: string, ahora: string = new Date().toISOString()): Cartera {
  const movimientos = cartera.movimientos.filter((movimiento) => movimiento.origen?.importacionId !== importacionId);
  const usados = new Set<string>();
  for (const movimiento of movimientos) {
    if (movimiento.activoId) usados.add(movimiento.activoId);
    if (movimiento.destino?.activoId) usados.add(movimiento.destino.activoId);
  }
  const antes = new Set<string>();
  for (const movimiento of cartera.movimientos) {
    if (movimiento.activoId) antes.add(movimiento.activoId);
    if (movimiento.destino?.activoId) antes.add(movimiento.destino.activoId);
  }
  return {
    ...cartera,
    movimientos,
    /* Solo se quitan los activos que usaba esta importación y ya nadie usa; uno que el asesor dio de alta sin movimientos se queda. */
    activos: cartera.activos.filter((activo) => usados.has(activo.id) || !antes.has(activo.id)),
    preciosManuales: cartera.preciosManuales.filter((precio) => usados.has(precio.activoId) || !antes.has(precio.activoId)),
    extractos: cartera.extractos.filter((extracto) => extracto.importacionId !== importacionId),
    importaciones: cartera.importaciones.filter((importacion) => importacion.id !== importacionId),
    modificada: ahora
  };
}

/**
 * Las posiciones iniciales que faltan para cuadrar con un extracto: por cada activo del
 * que el extracto declara más títulos que el libro, una entrada de títulos por la
 * diferencia. Es lo que hace falta cuando el libro empieza a medio camino.
 */
export function posicionesInicialesQueFaltan(diferencias: Array<{ activoId?: string; titulos: string; precio?: string }>, fecha: string): Movimiento[] {
  return diferencias
    .filter((diferencia) => diferencia.activoId && Number(diferencia.titulos) > 0)
    .map((diferencia) => ({
      id: nuevoId(),
      tipo: "entradaDeTitulos",
      fechaOperacion: fecha,
      activoId: diferencia.activoId,
      titulos: diferencia.titulos,
      precio: diferencia.precio,
      nota: "Posición inicial",
      origen: { via: "manual" as const }
    }));
}
