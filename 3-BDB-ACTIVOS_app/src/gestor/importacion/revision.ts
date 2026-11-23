/**
 * La revisión de una importación: lo que pasa entre «el importador propone» y «entra en el
 * libro». Aquí se decide qué activo de la cartera o del catálogo es cada activo que citan
 * los documentos, se marcan los movimientos que ya están en el libro y, cuando el asesor
 * confirma, se aplican. También se deshace una importación entera.
 *
 * Es cálculo puro: recibe la cartera, lo propuesto y el catálogo, y devuelve una cartera nueva.
 */
import { coincideConLoTecleado } from "../../core/busquedaDeActivos";
import { importe as importeEnTexto, numero, porcentaje, precio as precioEnTexto, titulos as titulosEnTexto } from "../../core/formato";
import { activoDesdeElCatalogo, type ActivoDeCatalogo } from "../mercado/fichas";
import { aNumero, aTexto, d } from "../motor/decimal";
import type { ContextoDeMovimiento } from "../motor/efectos";
import { yaEnElLibro } from "../motor/integridad";
import { contextoDe, validarMovimiento } from "../motor/libro";
import { divisaDelEfectivo, nuevoId, type Activo, type Cartera, type ExtractoDeclarado, type Importacion, type Movimiento, type PosicionDeclarada, type TipoDeActivo } from "../motor/modelo";
import { definicionDe } from "../motor/movimientos/registro";
import { DIVISAS_EN_CENTIMOS } from "./andbank/comun";
import type { ActivoCitado, ExtractoPropuesto, MovimientoPropuesto, ResultadoDeImportacion } from "./tipos";

/**
 * El precio por título de una posición de un extracto, con su divisa, para la posición declarada (A-205 y A-210). El de
 * Andbank ya es por título. El de la plantilla es la cotización —en un bono, en % del nominal, como en su hoja de
 * movimientos— y se lleva a precio por título con el multiplicador del activo decidido: 10.000 de nominal al 98,5 dan
 * 98,5 × 0,01 = 0,985 por unidad de nominal. Sin divisa, o con una cotización de un activo que no se ha decidido, no hay
 * precio, y la posición se valora como sin él.
 */
function precioPorTitulo(posicion: ExtractoPropuesto["posiciones"][number], activo: Activo | undefined): Pick<PosicionDeclarada, "precio" | "divisa"> {
  if (!posicion.divisa) return {};
  if (posicion.precio !== undefined) return { precio: posicion.precio, divisa: posicion.divisa };
  if (posicion.cotizacion !== undefined && activo) return { precio: aTexto(d(posicion.cotizacion).times(d(activo.multiplicador ?? "1"))), divisa: posicion.divisa };
  return {};
}

/** Qué se sabe de un activo citado por los documentos. */
export type EstadoDelActivoCitado =
  /** Ya está en la cartera. */
  | "en-cartera"
  /** No está en la cartera, pero el catálogo lo tiene por su ISIN: se dará de alta con sus precios. */
  | "en-catalogo"
  /** Trae ISIN pero el catálogo no lo tiene: se dará de alta como activo propio, con precio a mano. */
  | "nuevo"
  /**
   * Como «nuevo», pero el documento no dice qué tipo de activo es: solo se supone «acción» de una compra o una venta sin
   * más. El asesor lo elige antes de que sus movimientos entren, porque de eso depende cómo se lee su precio: en un bono,
   * en % del nominal (22-11-2026: 10.000 de nominal al 98,5 dados de alta como acción valían 985.000 €).
   */
  | "falta-el-tipo"
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
    /* El tipo: el primero que llegue, salvo que sea el supuesto y otra cita lo diga. */
    const tipoDeLaOtra = citado.tipo !== undefined && (previo.citado.tipo === undefined || (previo.citado.tipoSupuesto && !citado.tipoSupuesto));
    const supuesto = tipoDeLaOtra ? citado.tipoSupuesto : previo.citado.tipoSupuesto;
    const unido: ActivoCitado = {
      ...previo.citado,
      isin: previo.citado.isin ?? citado.isin,
      divisa: previo.citado.divisa ?? citado.divisa,
      tipo: tipoDeLaOtra ? citado.tipo : previo.citado.tipo,
      nombre: previo.citado.nombre.length >= citado.nombre.length ? previo.citado.nombre : citado.nombre
    };
    if (supuesto) unido.tipoSupuesto = true;
    else delete unido.tipoSupuesto;
    previo.citado = unido;
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
    const sugerencias = sugerenciasPorNombre(citado.nombre, catalogo);
    if (citado.tipoSupuesto) return { citado, estado: "falta-el-tipo", sugerencias, apariciones };
    return { citado, estado: "nuevo", propuesto: activoNuevoDelTipo(citado, citado.tipo ?? "OTRO", cartera.divisaBase), sugerencias, apariciones };
  }
  return { citado, estado: "por-decidir", sugerencias: sugerenciasPorNombre(citado.nombre, catalogo), apariciones };
}

/**
 * El activo nuevo, con precio a mano, que se da de alta para un activo citado: con su ISIN como identificador si lo trae, o
 * como activo propio (`propio`) si solo trae un nombre. Un bono cotiza en % del nominal y sus títulos son el nominal: multiplicador
 * 0,01, como el que se crea a mano en `SelectorDeActivo` y como dice la plantilla. Sin él, 10.000 de nominal al 98,5 valían
 * 985.000 € (P2-05).
 */
export function activoNuevoDelTipo(citado: ActivoCitado, tipo: TipoDeActivo, divisaBase: string, propio = false): Activo {
  const isin = propio ? undefined : citado.isin;
  const activo: Activo = {
    id: isin ?? `propio-${nuevoId().slice(0, 8)}`,
    nombre: citado.nombre,
    tipo,
    divisa: citado.divisa ?? divisaBase,
    origen: "manual"
  };
  if (isin) activo.isin = isin;
  if (tipo === "BONO") activo.multiplicador = "0.01";
  return activo;
}

/** Un activo propio (sin catálogo) para un activo citado solo por nombre. */
export function activoPropioPara(citado: ActivoCitado, divisaBase: string): Activo {
  return activoNuevoDelTipo(citado, citado.tipo ?? "OTRO", divisaBase, true);
}

/** Cuánto pueden diferir el importe de una compra o una venta y lo que dan sus títulos por su precio: un 2 %. */
export const TOLERANCIA_DEL_IMPORTE = "0.02";

/**
 * Si el importe de una compra, una venta, una suscripción, un reembolso o una amortización no cuadra con sus títulos por su
 * precio y por el multiplicador del activo, llevado a la divisa del efectivo con el cambio de la fila (y con los costes y
 * el cupón corrido que la fila declara, como al sugerir el importe a mano): el aviso que lo dice, con las dos cifras. Sin
 * títulos, precio o importe, o sin un cambio con que convertir, no se compara. La diferencia admitida es
 * `TOLERANCIA_DEL_IMPORTE` de lo esperado.
 *
 * Es la guarda de la importación del 22-11-2026: un bono leído como acción (precio en % por título, cien veces más) y unos
 * peniques leídos como libras (cien veces más) pasaban sin aviso. Desde el 23-11-2026 la línea en la que salta no entra por
 * defecto (`conDescuadre`), y el asesor puede marcarla e importarla igual.
 */
export function descuadreDelImporte(movimiento: Movimiento, contexto: ContextoDeMovimiento): string | undefined {
  const definicion = definicionDe(movimiento.tipo);
  if (!definicion?.importeSugerido || !movimiento.titulos || !movimiento.precio || !movimiento.importe) return undefined;
  const sugerido = definicion.importeSugerido(movimiento, contexto);
  if (!sugerido || sugerido.eq(0)) return undefined;
  const esperado = sugerido.abs();
  const declarado = d(movimiento.importe).abs();
  if (declarado.minus(esperado).abs().lte(esperado.times(TOLERANCIA_DEL_IMPORTE))) return undefined;

  const activo = contexto.activo(movimiento.activoId)!;
  const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
  const multiplicador = d(activo.multiplicador ?? "1");
  const precio = d(movimiento.precio);
  const comoCotiza = multiplicador.eq("0.01")
    ? `al ${porcentaje(aNumero(precio.div(100)))} del nominal`
    : `a ${precioEnTexto(aNumero(precio), { divisa: activo.divisa })}${multiplicador.eq(1) ? "" : ` con multiplicador ${numero(aNumero(multiplicador), { decimales: 4 })}`}`;
  const conCambio = activo.divisa !== divisa && movimiento.cambio ? ` y un cambio de ${numero(aNumero(d(movimiento.cambio)), { decimales: 4 })}` : "";
  const conCostes = movimiento.comision || movimiento.gastos || movimiento.cuponCorrido ? ", con los costes y el cupón corrido de la fila," : "";
  const frase = `El importe no cuadra con los títulos y el precio: con ${titulosEnTexto(d(movimiento.titulos))} títulos ${comoCotiza}${conCambio}${conCostes} sería ${importeEnTexto(aNumero(esperado), { divisa })}, y la fila dice ${importeEnTexto(aNumero(declarado), { divisa })}.`;

  const veces = esperado.div(declarado.gt(0) ? declarado : d("1e-12"));
  if (veces.gte(50) && veces.lte(200)) {
    if (DIVISAS_EN_CENTIMOS.has(activo.divisa) && conCambio !== "") {
      return `${frase} Es unas cien veces más: el cambio de «${activo.divisa}» va en peniques por 1 de ${divisa}, y ${numero(aNumero(d(movimiento.cambio!)), { decimales: 4 })} libras se escriben ${numero(aNumero(d(movimiento.cambio!).times(100)), { decimales: 2 })}.`;
    }
    return `${frase} Es unas cien veces más: si es un bono, su precio va en % del nominal; si cotiza en peniques, su divisa es «GBp».`;
  }
  if (veces.gte("0.005") && veces.lte("0.02")) {
    return `${frase} Es unas cien veces menos: comprueba si el precio va en % del nominal o por título, y la divisa del activo.`;
  }
  return frase;
}

export interface LineaDeRevision {
  propuesto: MovimientoPropuesto;
  entidad: string;
  /** El movimiento con sus activos ya sustituidos por los decididos, o `undefined` si falta decidir alguno o se ha omitido. */
  movimiento?: Movimiento;
  /** Errores del motor para ese movimiento: con alguno, no se puede importar tal cual. */
  errores: string[];
  /**
   * Lo que la revisión ve en la línea con sus activos ya decididos y el importador no podía ver: que el importe no cuadra
   * con los títulos y el precio (`descuadreDelImporte`). No impide importarla, pero la deja sin marcar (`conDescuadre`).
   */
  avisos: string[];
  /** Si el importe no cuadra con los títulos y el precio por encima de `TOLERANCIA_DEL_IMPORTE`: entonces no entra por defecto. */
  conDescuadre: boolean;
  /** Ya hay en el libro un movimiento igual. */
  duplicado: boolean;
  /** Si entra por defecto: válido, sin duplicar, con sus activos decididos, clasificado y con un importe que cuadra. */
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

/** Por qué no entra una línea cuyo activo nuevo espera a que el asesor diga qué tipo de activo es. */
export const MOTIVO_FALTA_EL_TIPO = "Falta decir qué tipo de activo es.";

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
  const faltaElTipo = new Set(activos.filter((activo) => activo.estado === "falta-el-tipo").map((activo) => activo.citado.clave));
  const sinDecidir = (citado: ActivoCitado | undefined, decision: DecisionSobreUnActivo | undefined): boolean => citado !== undefined && !decision;

  const lineas: LineaDeRevision[] = [];
  for (const resultado of resultados) {
    for (const propuesto of resultado.movimientos) {
      const linea: LineaDeRevision = { propuesto, entidad: resultado.entidad, errores: [], avisos: [], conDescuadre: false, duplicado: false, porDefecto: false };
      const origen = propuesto.activo ? decidido.get(propuesto.activo.clave) : undefined;
      const destino = propuesto.destino ? decidido.get(propuesto.destino.clave) : undefined;
      if (origen === "omitir" || destino === "omitir") linea.motivo = "Se ha dejado fuera su activo.";
      else if (sinDecidir(propuesto.activo, origen) || sinDecidir(propuesto.destino, destino)) {
        const delTipo = (sinDecidir(propuesto.activo, origen) && faltaElTipo.has(propuesto.activo!.clave)) || (sinDecidir(propuesto.destino, destino) && faltaElTipo.has(propuesto.destino!.clave));
        linea.motivo = delTipo ? MOTIVO_FALTA_EL_TIPO : "Falta decir qué activo es.";
      } else {
        const movimiento: Movimiento = { ...propuesto.movimiento };
        if (propuesto.activo && origen) movimiento.activoId = origen.id;
        if (propuesto.destino && destino && movimiento.destino) movimiento.destino = { ...movimiento.destino, activoId: destino.id };
        linea.movimiento = movimiento;
        linea.errores = validarMovimiento(movimiento, contexto);
        if (linea.errores.length > 0) linea.motivo = linea.errores[0];
        else {
          const descuadre = descuadreDelImporte(movimiento, contexto);
          if (descuadre) {
            linea.avisos.push(descuadre);
            linea.conDescuadre = true;
          }
        }
      }
      lineas.push(linea);
    }
  }

  const candidatos = lineas.filter((linea) => linea.movimiento).map((linea) => linea.movimiento!);
  const repetidos = yaEnElLibro(candidatos, cartera.movimientos);
  for (const linea of lineas) {
    linea.duplicado = linea.movimiento !== undefined && repetidos.has(linea.movimiento.id);
    if (linea.duplicado) linea.motivo = "Ya está en el libro.";
    /* A-156 y decisión 1 de la auditoría consolidada del 22-11 (23-11-2026): lo sin clasificar y un importe que no cuadra no
       entran solos. Se cuentan «por revisar», y el asesor puede marcarlos. */
    linea.porDefecto = linea.movimiento !== undefined && linea.errores.length === 0 && !linea.duplicado && !sinClasificar(linea.propuesto) && !linea.conDescuadre;
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
          return { activoId: activo && activos.some((existente) => existente.id === activo.id) ? activo.id : undefined, isin: posicion.activo.isin, nombre: posicion.activo.nombre, titulos: posicion.titulos, valor: posicion.valor, ...(posicion.fecha ? { fecha: posicion.fecha } : {}), ...precioPorTitulo(posicion, activo) };
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
