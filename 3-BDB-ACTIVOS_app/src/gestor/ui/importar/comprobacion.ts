/**
 * El tercer paso del asistente, sin React: cómo quedaría la cartera con lo elegido y si
 * cuadra con lo que declaran los extractos. Nada de esto toca la cartera abierta: se calcula
 * sobre una copia, y solo «Importar» la sustituye.
 *
 * Cuando el libro empieza a medio camino (la cuenta se abrió antes del primer extracto), el
 * extracto de posiciones declara títulos que el libro no tiene. Para eso se proponen las
 * POSICIONES INICIALES: una entrada de títulos por cada diferencia, la víspera del primer
 * movimiento importado y con el precio que sale del propio extracto.
 */
import { aplicarImportacion, posicionesInicialesQueFaltan, type DecisionSobreUnActivo, type Revision } from "../../importacion/revision";
import type { ResultadoDeImportacion } from "../../importacion/tipos";
import { aTexto, d, redondear } from "../../motor/decimal";
import { minimoDia, sumarDias, type Dia } from "../../motor/fechas";
import { conciliar, posicionesPorActivo, type Conciliacion } from "../../motor/integridad";
import type { Activo, Cartera, ExtractoDeclarado, Importacion, Movimiento, PosicionDeclarada } from "../../motor/modelo";
import { escrito } from "../textos";

/** Una posición inicial que el asesor ha decidido añadir: el activo (quizá aún fuera de la cartera) y su entrada de títulos. */
export interface PosicionInicial {
  activo: Activo;
  movimiento: Movimiento;
  /** La posición del extracto de la que sale: para que el extracto apunte al activo si este entra ahora. */
  declarada: { isin?: string; nombre: string };
}

export interface Comprobacion {
  /** La cartera tal como quedaría. */
  cartera: Cartera;
  importacion: Importacion;
  /** Una por cada extracto que traen los documentos. */
  conciliaciones: Conciliacion[];
  /** Movimientos que entran: los elegidos más las posiciones iniciales. */
  movimientos: number;
  cuadra: boolean;
}

/** Si una posición declarada corresponde a un activo. */
function esDelActivo(posicion: PosicionDeclarada, activo: Activo): boolean {
  if (posicion.activoId) return posicion.activoId === activo.id;
  if (posicion.isin) return posicion.isin === activo.isin;
  return posicion.nombre.trim().toLowerCase() === activo.nombre.trim().toLowerCase();
}

/**
 * La cartera con lo elegido y las posiciones iniciales añadidas, y su conciliación con cada
 * extracto nuevo. Las posiciones iniciales entran con la marca de la importación, para que
 * deshacerla las quite también.
 */
export function comprobar(
  cartera: Cartera,
  resultados: readonly ResultadoDeImportacion[],
  revision: Revision,
  elegidas: ReadonlySet<string>,
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo>,
  iniciales: readonly PosicionInicial[] = [],
  ahora?: string
): Comprobacion {
  const aplicada = aplicarImportacion(cartera, resultados, revision, elegidas, decisiones, ahora);
  let resultante = aplicada.cartera;
  const importacion: Importacion = { ...aplicada.importacion, movimientos: aplicada.importacion.movimientos + iniciales.length };

  if (iniciales.length > 0) {
    const activos = [...resultante.activos];
    for (const { activo } of iniciales) if (!activos.some((existente) => existente.id === activo.id)) activos.push(activo);
    const movimientos = [
      ...resultante.movimientos,
      ...iniciales.map(({ movimiento }) => ({ ...movimiento, origen: { via: "importado" as const, importacionId: importacion.id, documento: movimiento.origen?.documento } }))
    ];
    /* Un activo que solo cita el extracto entra ahora en la cartera: su posición declarada pasa a apuntarle. */
    const extractos = resultante.extractos.map((extracto) =>
      extracto.importacionId !== importacion.id
        ? extracto
        : {
            ...extracto,
            posiciones: extracto.posiciones.map((posicion) => {
              if (posicion.activoId) return posicion;
              const activo = iniciales.find(({ declarada }) => (declarada.isin ? declarada.isin === posicion.isin : !posicion.isin && declarada.nombre === posicion.nombre))?.activo;
              return activo ? { ...posicion, activoId: activo.id } : posicion;
            })
          }
    );
    resultante = {
      ...resultante,
      activos,
      movimientos,
      extractos,
      importaciones: resultante.importaciones.map((existente) => (existente.id === importacion.id ? importacion : existente))
    };
  }

  const conciliaciones = resultante.extractos.filter((extracto) => extracto.importacionId === importacion.id).map((extracto) => conciliar(resultante, extracto));
  return { cartera: resultante, importacion, conciliaciones, movimientos: importacion.movimientos, cuadra: conciliaciones.every((conciliacion) => conciliacion.cuadra) };
}

export interface PropuestaDeIniciales {
  propuestas: PosicionInicial[];
  /** Las que no se pueden proponer, con el motivo: «Tecnologia Americana Inc: el extracto da su valor en EUR y el activo cotiza en USD». */
  sinProponer: string[];
}

/** El activo de una posición declarada: el de la cartera resultante, o el que se decidió en la revisión. */
function activoDeLaPosicion(posicion: PosicionDeclarada, cartera: Cartera, revision: Revision, decisiones: ReadonlyMap<string, DecisionSobreUnActivo>): Activo | "omitir" | undefined {
  const enCartera = cartera.activos.find((activo) => esDelActivo(posicion, activo));
  if (enCartera) return enCartera;
  const nombre = posicion.nombre.trim().toLowerCase();
  const citado =
    (posicion.isin ? revision.activos.find((activo) => activo.citado.isin === posicion.isin) : undefined) ??
    revision.activos.find((activo) => activo.citado.nombre.trim().toLowerCase() === nombre);
  if (!citado) return undefined;
  return decisiones.get(citado.citado.clave) ?? citado.propuesto;
}

/** El primer día de lo que se importa: la víspera es la fecha de las posiciones iniciales. */
function primerDia(revision: Revision, elegidas: ReadonlySet<string>, extracto: ExtractoDeclarado): Dia {
  let primero = extracto.fecha;
  for (const linea of revision.lineas) {
    if (linea.movimiento && elegidas.has(linea.propuesto.movimiento.id)) primero = minimoDia(primero, linea.movimiento.fechaOperacion);
  }
  return primero;
}

/**
 * Las posiciones iniciales que harían cuadrar los títulos: por cada posición de la que el
 * extracto declara MÁS títulos que el libro, una entrada de títulos por la diferencia.
 *
 * El precio es el valor declarado entre los títulos declarados (y entre el multiplicador, en
 * un bono). El extracto da ese valor en la divisa base de la cartera, así que solo sirve como
 * precio si el activo cotiza en ella; si no, o si el extracto no da el valor, no se propone y
 * se dice por qué.
 */
export function proponerPosicionesIniciales(
  comprobacion: Comprobacion,
  revision: Revision,
  elegidas: ReadonlySet<string>,
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo>
): PropuestaDeIniciales {
  const { cartera } = comprobacion;
  const propuestas: PosicionInicial[] = [];
  const sinProponer: string[] = [];
  const vistos = new Set<string>();

  for (const conciliacion of comprobacion.conciliaciones) {
    const { extracto } = conciliacion;
    /* Una por activo, como las compara `conciliar` (GES-6): con el mismo valor en dos filas se proponía solo la primera. */
    for (const posicion of posicionesPorActivo(cartera, extracto)) {
      /* El activo como lo encuentra `conciliar`: por su identificador o por su ISIN. */
      const enElLibro = (posicion.activoId ? cartera.activos.find((activo) => activo.id === posicion.activoId) : undefined) ?? (posicion.isin ? cartera.activos.find((activo) => activo.isin === posicion.isin) : undefined);
      const diferencia = conciliacion.diferencias.find((candidata) => candidata.clase === "titulos" && (enElLibro ? candidata.activoId === enElLibro.id : !candidata.activoId && candidata.concepto === posicion.nombre));
      if (!diferencia || !diferencia.diferencia.lt(0)) continue;
      const activo = enElLibro ?? activoDeLaPosicion(posicion, cartera, revision, decisiones);
      const nombre = activo && activo !== "omitir" ? activo.nombre : posicion.nombre;
      if (vistos.has(nombre)) continue;
      vistos.add(nombre);
      if (activo === "omitir") {
        sinProponer.push(`${nombre}: se ha dejado fuera en la revisión.`);
        continue;
      }
      if (!activo) {
        sinProponer.push(`${nombre}: falta decir qué activo es en la revisión.`);
        continue;
      }
      const declarados = d(posicion.titulos);
      if (!posicion.valor || declarados.lte(0)) {
        sinProponer.push(`${nombre}: el extracto no da su valor, así que no se sabe a qué precio entraron los títulos. Añádela a mano con su precio de coste.`);
        continue;
      }
      if (activo.divisa !== cartera.divisaBase) {
        sinProponer.push(`${nombre}: el extracto da su valor en ${cartera.divisaBase} y el activo cotiza en ${activo.divisa}, así que no se sabe su precio. Añádela a mano con su precio de coste.`);
        continue;
      }
      const multiplicador = d(activo.multiplicador ?? "1");
      const precio = aTexto(redondear(d(posicion.valor).div(declarados.times(multiplicador)), 6));
      const dia = sumarDias(primerDia(revision, elegidas, extracto), -1);
      const [movimiento] = posicionesInicialesQueFaltan([{ activoId: activo.id, titulos: aTexto(diferencia.diferencia.abs()), precio }], dia);
      if (!movimiento) continue;
      propuestas.push({ activo, movimiento: { ...movimiento, origen: { via: "importado", documento: extracto.documento } }, declarada: { isin: posicion.isin, nombre: posicion.nombre } });
    }
  }
  return { propuestas, sinProponer };
}

/** «La cartera cuadra con el extracto del 30 sep 2025: 6 posiciones y el saldo de efectivo». */
export function fraseDeCuadre(conciliacion: Conciliacion): string {
  const { extracto } = conciliacion;
  const partes: string[] = [];
  const posiciones = extracto.posiciones.length;
  if (posiciones > 0) partes.push(posiciones === 1 ? "1 posición" : `${posiciones} posiciones`);
  if (extracto.efectivo.length === 1) partes.push("el saldo de efectivo");
  else if (extracto.efectivo.length > 1) partes.push(`los ${extracto.efectivo.length} saldos de efectivo`);
  const que = partes.length > 0 ? `: ${partes.join(" y ")}` : "";
  return `La cartera cuadra con el extracto del ${escrito.fecha(extracto.fecha)}${que}.`;
}

/** Lo que suele significar cada clase de diferencia, en lenguaje llano. Una frase por clase presente. */
export function queSueleSignificar(conciliacion: Conciliacion): string[] {
  const frases: string[] = [];
  const titulos = conciliacion.diferencias.filter((diferencia) => diferencia.clase === "titulos");
  if (titulos.some((diferencia) => diferencia.diferencia.lt(0))) {
    frases.push("El extracto declara títulos que el libro no tiene. Lo normal es que el libro no empiece en la apertura de la cuenta: faltan las posiciones iniciales.");
  }
  if (titulos.some((diferencia) => diferencia.diferencia.gt(0))) {
    frases.push("El libro tiene títulos que el extracto ya no declara: puede faltar una venta, un reembolso o un traspaso de salida, o haberse dejado fuera en la revisión.");
  }
  if (conciliacion.diferencias.some((diferencia) => diferencia.clase === "efectivo")) {
    frases.push("El saldo de efectivo no coincide: puede faltar algún movimiento de la cuenta (la aportación inicial, una comisión, un cargo) o haberse dejado fuera en la revisión.");
  }
  return frases;
}

/** «Importar 42 movimientos de Andbank». */
export function descripcionDeLaImportacion(comprobacion: Comprobacion): string {
  const n = comprobacion.movimientos;
  return `Importar ${n} ${n === 1 ? "movimiento" : "movimientos"} de ${comprobacion.importacion.entidad}`;
}
