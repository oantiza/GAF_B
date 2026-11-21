import { importeGrande, precioConDivisa } from "../core/cifrasDeFicha";
import * as formato from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { CeldaDeSeccion, FilaDeFicha, SeccionDeFicha, Trozo } from "../types/fichaInstrumento";
import type { Documento, InstrumentoDeLaBase } from "./baseNuevaLectura";

/**
 * Lo que la ficha enseña de lo que publica el emisor de un ETF (decisiones 51 y 52 de Óscar, 08-11-2026).
 *
 * El emisor NO sustituye a nada: el coste corriente, el índice y el patrimonio de la ficha siguen saliendo de donde salían, y estas
 * secciones se pintan al lado, diciendo de quién es cada cifra y sin elegir por el asesor. Las métricas siguen sobre precio de mercado.
 */

const SUFIJO_DATOS = "declared/issuer_data";
const SUFIJO_PRIMA = "computed/premium_discount";

/** Los seis adaptadores, como se llaman. Otro se enseña tal cual. */
const NOMBRE_DEL_EMISOR: Record<string, string> = {
  ishares: "iShares",
  amundi: "Amundi",
  xtrackers: "Xtrackers",
  vanguard: "Vanguard",
  spdr: "SPDR",
  invesco: "Invesco"
};

function valorEn(documento: Documento | undefined, ruta: string): unknown {
  return ruta
    .split(".")
    .reduce<unknown>(
      (actual, tramo) => (actual && typeof actual === "object" ? (actual as Record<string, unknown>)[tramo] : undefined),
      documento
    );
}

/* Cada cifra con lo que es (apartado 6 de SISTEMA_DISENO.md). Lo que falta dice que falta, nunca «N/D». */
const dia = (valor: unknown) => formato.oFalta(typeof valor === "string" ? formato.fecha(valor) : null);
/** La prima o el descuento: una variación del cierre sobre el valor liquidativo, con su signo y dos decimales. */
const pctConSigno = (valor: unknown) => formato.oFalta(formato.rentabilidad(typeof valor === "number" ? valor : null));
/** Un coste: dos decimales, sin signo. */
const coste = (valor: number) => formato.oFalta(formato.porcentaje(valor));
const cuenta = (valor: number) => formato.oFalta(formato.numero(valor));

/** «issuer:ishares» → «iShares». La usa también el mercado objetivo, que trae la misma fuente. */
export function nombreDelEmisor(datos: Documento | undefined): string {
  const fuente = String(valorEn(datos, "source") ?? "");
  const adaptador = fuente.startsWith("issuer:") ? fuente.slice("issuer:".length) : fuente;
  return NOMBRE_DEL_EMISOR[adaptador] ?? adaptador;
}

function procedencia(etiqueta: string, fecha: unknown): Trozo[] {
  const trozos: Trozo[] = [{ texto: etiqueta, fuerte: true }];
  if (fecha) trozos.push({ texto: ` · ${dia(fecha)}` });
  return trozos;
}

/** La comisión de swap se escribe con cuatro decimales: a dos, 0,0718 % y 0,03 % se confunden con cifras redondas. */
function comisionDeSwap(valor: number): string {
  return formato.oFalta(valor === 0 ? formato.porcentaje(0) : formato.porcentaje(valor, { decimales: 4 }));
}

/** La política de reparto del emisor en una fila de la ficha, para cuando el proveedor no la sabe (decisión 55): rellena un hueco y dice de quién es. */
export function filaDePoliticaDelEmisor(instrumento: InstrumentoDeLaBase, rotulo: string): FilaDeFicha | undefined {
  const datos = instrumento.bloques[SUFIJO_DATOS];
  const politica = valorEn(datos, "distribution_policy.value");
  const valor = politica === "ACCUMULATING" ? "Acumulación" : politica === "DISTRIBUTING" ? "Reparto" : undefined;
  if (valor === undefined) return undefined;
  return { rotulo, valor, glosa: `Del emisor (${nombreDelEmisor(datos)}), a ${dia(valorEn(datos, "as_of"))}. El proveedor no la declara.` };
}

/** La fila de la comisión de swap, si el emisor la declara. La lee la sección de coste, y va aparte del coste corriente. */
export function filaDeComisionDeSwap(instrumento: InstrumentoDeLaBase): FilaDeFicha | undefined {
  const datos = instrumento.bloques[SUFIJO_DATOS];
  const swap = valorEn(datos, "costs.swap_fee");
  if (typeof swap !== "number") return undefined;
  return {
    rotulo: "Comisión de swap",
    valor: comisionDeSwap(swap),
    glosa: `Del emisor (${nombreDelEmisor(datos)}), a ${dia(valorEn(datos, "as_of"))}. Es aparte del coste corriente: el inversor la paga y no está en esa cifra.`
  };
}

/** Por qué no se publica la prima, en palabras. Cada motivo del contrato tiene la suya. */
const PRIMA_SIN_CIFRA: Record<string, string> = {
  ISSUER_SERIES_IS_CUMULATIVE_RETURN: "El emisor publica rentabilidad acumulada con repartos reinvertidos, no valor liquidativo: no hay con qué comparar el cierre.",
  DERIVED_WITHOUT_ANCHOR: "El valor liquidativo es deducido y no tiene un valor declarado del que colgar.",
  NO_MARKET_SERIES: "No hay serie de precio de mercado con la que compararlo.",
  NO_NAV_POINTS: "El emisor no da puntos de valor liquidativo con los que calcularla.",
  DISTRIBUTIONS_UNAVAILABLE: "Esta clase reparte y faltan los pagos con los que ajustar el valor liquidativo.",
  DISTRIBUTION_CURRENCY_MISMATCH: "Los repartos del emisor están en otra divisa que su valor liquidativo.",
  NO_FX_RATE: "No hay cambio del BCE con el que llevar el valor liquidativo a la divisa de la cotización.",
  INSUFFICIENT_OVERLAP: "Hay menos de 200 días con cierre y valor liquidativo a la vez en estos 12 meses.",
  SCALE_MISMATCH: "Alguna fecha se sale más del 20 %: no es una prima, es una línea o una divisa que no cuadran."
};

function filasDeLaPrima(prima: Documento): FilaDeFicha[] {
  if (prima.status !== "PUBLISHED") {
    return [
      {
        rotulo: "Prima o descuento",
        valor: textoDeAusencia("falta"),
        ausencia: "falta",
        glosa: PRIMA_SIN_CIFRA[String(prima.absence_reason)] ?? "No se ha podido calcular."
      }
    ];
  }
  return [
    { rotulo: "Prima o descuento, media 12 meses", valor: pctConSigno(prima.mean), glosa: `${String(prima.observations)} sesiones.` },
    { rotulo: "Prima o descuento, última", valor: pctConSigno(prima.latest), glosa: `A ${dia(prima.as_of)}.` }
  ];
}

function notaDeLaPrima(prima: Documento): string {
  const base = "Las métricas de esta ficha se calculan sobre el precio de mercado, no sobre este valor liquidativo.";
  if (prima.status !== "PUBLISHED") return base;
  const conCambio = prima.fx_source ? ", y el cambio del BCE es de las 14:15" : "";
  const conRepartos = prima.nav_adjustment === "DISTRIBUTIONS_BACK_ADJUSTED" ? " El valor liquidativo va ajustado por sus repartos, igual que el cierre." : "";
  return `${base} La prima compara su cierre con el valor liquidativo, que se forman a horas distintas${conCambio}: un día suelto lleva ese desfase, y la media dice más.${conRepartos}`;
}

function seccionDelValorLiquidativo(instrumento: InstrumentoDeLaBase): SeccionDeFicha {
  const datos = instrumento.bloques[SUFIJO_DATOS];
  const prima = instrumento.bloques[SUFIJO_PRIMA];
  const emisor = nombreDelEmisor(datos);
  const clase = valorEn(datos, "nav.series_class");
  const fecha = valorEn(datos, "nav.last_date");
  const valor = valorEn(datos, "nav.last_value");
  const moneda = valorEn(datos, "nav.currency");

  const filaDelVl: FilaDeFicha =
    clase === "ISSUER_CUMULATIVE_RETURN"
      ? {
          rotulo: "Valor liquidativo",
          valor: textoDeAusencia("falta"),
          ausencia: "falta",
          glosa: `${emisor} publica una rentabilidad acumulada con los repartos reinvertidos, que no es un precio por participación.`
        }
      : {
          rotulo: "Valor liquidativo",
          /* Un valor liquidativo: de dos a cuatro decimales, con su divisa; sin divisa declarada no se le pone una. */
          valor: typeof valor === "number" ? precioConDivisa(valor, moneda) : textoDeAusencia("falta"),
          ...(typeof valor === "number" ? { destacada: true } : { ausencia: "falta" as const }),
          ...(clase === "ISSUER_NAV_DERIVED"
            ? {
                glosa: `Deducido: es el último valor liquidativo que declara ${emisor}, llevado hacia atrás con su rentabilidad acumulada. ${emisor} no publica el histórico.`
              }
            : {})
        };

  return {
    id: "vl-emisor",
    titulo: "Valor liquidativo del emisor",
    procedencia: procedencia(clase === "ISSUER_NAV_DERIVED" ? `Deducido de lo que publica ${emisor}` : `Declarado por ${emisor}`, fecha),
    filas: [filaDelVl, ...(prima ? filasDeLaPrima(prima) : [])],
    nota: prima ? notaDeLaPrima(prima) : undefined
  };
}

/** Sin mayúsculas ni espacios de más, para no llamar diferencia a una ortografía. */
function plegar(texto: unknown): string {
  return String(texto).trim().toLowerCase().replace(/\s+/g, " ");
}

const SOLO_EL_EMISOR: CeldaDeSeccion = "Solo lo da el emisor";

/** Las dos celdas de cuando el emisor cuenta líneas y el proveedor títulos: cada cifra en su fila, y ninguna frente a la otra. */
const NO_SE_COMPARA: CeldaDeSeccion = { texto: "No se compara", ausencia: "no-aplica" };
const EL_EMISOR_NO_LO_DECLARA: CeldaDeSeccion = { texto: "No lo declara", ausencia: "no-aplica" };

const POLITICA: Record<string, string> = { ACCUMULATING: "Acumula", DISTRIBUTING: "Reparte" };
const REPLICA: Record<string, string> = { PHYSICAL: "Física", SYNTHETIC: "Sintética" };

/** De quién es una cifra de los costes de siempre (decisión 43). */
function fuenteDelCoste(costes: Documento | undefined): string {
  const fecha = valorEn(costes, "document_date");
  return valorEn(costes, "ongoing_charge_source") === "KID"
    ? fecha
      ? `KID de ${dia(fecha)}`
      : "KID, sin fecha"
    : `proveedor, ${dia(valorEn(costes, "as_of"))}`;
}

/** Una cuenta con su fecha, si la tiene. */
function conSuFecha(valor: number, fecha: unknown): string {
  return fecha ? `${cuenta(valor)} · ${dia(fecha)}` : cuenta(valor);
}

/**
 * El recuento de títulos que declara el emisor, si lo que declara lo es.
 *
 * Solo cuenta cuando queda por debajo de sus líneas, porque entonces deja fuera liquidez y derivados, que es lo que hace un recuento de
 * títulos: iShares declara 1.247 con 1.280 líneas. Vanguard rellena el campo con sus propias líneas (513 y 513) y Amundi con esas líneas
 * más la de efectivo (613 y 612): en los dos, el campo dice cuántas líneas hay, no cuántos títulos.
 */
function titulosDeclarados(datos: Documento | undefined): number | undefined {
  const lineas = valorEn(datos, "holdings.positions_count");
  const declarados = valorEn(datos, "holdings.declared_positions_count");
  return typeof declarados === "number" && typeof lineas === "number" && declarados < lineas ? declarados : undefined;
}

function esCestaDeSustitucion(datos: Documento | undefined): boolean {
  return valorEn(datos, "holdings.nature") === "SUBSTITUTE_BASKET";
}

/**
 * Las posiciones del emisor, con las reglas de la decisión 55: las dos cifras con su definición y su fecha, «Coincide» solo cuando miden
 * lo mismo y dan lo mismo, y nunca «difiere». Es la regla de la §3 del método aplicada a una cuenta.
 */
function filasDePosiciones(datos: Documento | undefined, cartera: Documento | undefined): CeldaDeSeccion[][] {
  const lineas = valorEn(datos, "holdings.positions_count");
  if (typeof lineas !== "number") return [];
  const fecha = valorEn(datos, "holdings.as_of");

  /* Un sintético no compra lo que replica: su cesta y la cartera del proveedor, que es un swap, no se miran la una a la otra. */
  if (esCestaDeSustitucion(datos)) {
    const contrapartes = ((valorEn(datos, "holdings.counterparties") ?? []) as Documento[]).map((contraparte) => String(contraparte.name));
    const cesta: CeldaDeSeccion[] = ["Posiciones de la cesta", conSuFecha(lineas, fecha), SOLO_EL_EMISOR];
    return contrapartes.length > 0 ? [cesta, ["Contraparte del swap", contrapartes.join(", "), SOLO_EL_EMISOR]] : [cesta];
  }

  const delProveedor = valorEn(cartera, "securities_count");
  const delProveedorConFecha = `${cuenta(Number(delProveedor))}, proveedor, ${dia(valorEn(cartera, "as_of"))}`;
  const titulos = titulosDeclarados(datos);
  if (titulos !== undefined) {
    const celda: CeldaDeSeccion =
      typeof delProveedor !== "number"
        ? SOLO_EL_EMISOR
        : delProveedor === titulos
          ? `Coincide, proveedor, ${dia(valorEn(cartera, "as_of"))}`
          : delProveedorConFecha;
    return [["Títulos en cartera", conSuFecha(titulos, fecha), celda]];
  }

  /* Sin recuento de títulos, lo del emisor son líneas, y lo del proveedor va en su fila: enfrentarlas sería comparar dos cosas distintas. */
  const filaDeLineas: CeldaDeSeccion[] = ["Líneas de la cartera, con liquidez y derivados", conSuFecha(lineas, fecha)];
  if (typeof delProveedor !== "number") return [[...filaDeLineas, SOLO_EL_EMISOR]];
  return [
    [...filaDeLineas, NO_SE_COMPARA],
    ["Títulos en cartera", EL_EMISOR_NO_LO_DECLARA, delProveedorConFecha]
  ];
}

function filasDeLaComparacion(instrumento: InstrumentoDeLaBase): CeldaDeSeccion[][] {
  const { raiz, bloques } = instrumento;
  const datos = bloques[SUFIJO_DATOS];
  const costes = bloques["declared/costs"];
  const perfil = bloques["declared/profile"];
  const tamano = bloques["declared/size"];
  const cartera = bloques["declared/holdings"];

  const filas: CeldaDeSeccion[][] = [];

  /* Una fila solo si el emisor dice algo: lo que él no publica no se pinta como un hueco suyo. La única excepción son los títulos del proveedor, junto a las líneas del emisor. */
  const terEmisor = valorEn(datos, "costs.ongoing_charge");
  if (typeof terEmisor === "number") {
    const otro = valorEn(costes, "ongoing_charge");
    const celda: CeldaDeSeccion =
      typeof otro !== "number"
        ? SOLO_EL_EMISOR
        : Math.abs(otro - terEmisor) < 0.000005
          ? "Coincide"
          : `${coste(otro)}, ${fuenteDelCoste(costes)}`;
    filas.push(["Coste corriente", coste(terEmisor), celda]);
  }

  const politicaEmisor = valorEn(datos, "distribution_policy.value");
  if (typeof politicaEmisor === "string") {
    const otra = valorEn(perfil, "distribution_policy");
    const celda: CeldaDeSeccion =
      otra === politicaEmisor
        ? "Coincide"
        : typeof otra === "string" && POLITICA[otra]
          ? `${POLITICA[otra]}, ficha del proveedor`
          : { texto: "Sin declarar por el proveedor", ausencia: "falta" };
    filas.push(["Reparto", POLITICA[politicaEmisor] ?? politicaEmisor, celda]);
  }

  const tipoDeReplica = valorEn(datos, "replication.type");
  if (typeof tipoDeReplica === "string") {
    const muestreo = valorEn(datos, "replication.sampling");
    const texto = `${REPLICA[tipoDeReplica] ?? tipoDeReplica}${muestreo === true ? ", con muestreo" : muestreo === false ? ", completa" : ""}`;
    filas.push(["Réplica", texto, SOLO_EL_EMISOR]);
  }

  const indiceEmisor = valorEn(datos, "index.name");
  if (typeof indiceEmisor === "string") {
    const otro = valorEn(raiz, "classification.official_benchmark.name");
    const celda: CeldaDeSeccion =
      typeof otro !== "string" ? SOLO_EL_EMISOR : plegar(otro) === plegar(indiceEmisor) ? "Coincide" : `${otro}, proveedor`;
    filas.push(["Índice de referencia", indiceEmisor, celda]);
  }

  const clase = valorEn(datos, "size.share_class") as Documento | undefined;
  const fondo = valorEn(datos, "size.fund") as Documento | undefined;
  if (clase || fondo) {
    const partes = [
      clase ? `${importeGrande(clase.aum, clase.currency)} la clase` : undefined,
      fondo ? `${importeGrande(fondo.aum, fondo.currency)} el fondo` : undefined
    ].filter((parte): parte is string => parte !== undefined);
    const fechaDelEmisor = (clase ?? fondo)?.as_of;
    const otro = valorEn(tamano, "aum");
    filas.push([
      "Patrimonio",
      `${partes.join(" · ")} · ${dia(fechaDelEmisor)}`,
      /* Nunca «Coincide»: fechas, divisas y alcance (clase o fondo) rara vez son los mismos, y lo que se compara se ve. */
      typeof otro === "number" ? `${importeGrande(otro, valorEn(tamano, "currency"))}, proveedor, ${dia(valorEn(tamano, "as_of"))}` : SOLO_EL_EMISOR
    ]);
  }

  filas.push(...filasDePosiciones(datos, cartera));

  const pesoEmisor = valorEn(datos, "holdings.top10_weight");
  if (typeof pesoEmisor === "number") {
    const otro = valorEn(cartera, "top10_weight");
    filas.push([
      "Peso de las diez mayores",
      /* Un peso: un decimal. */
      formato.oFalta(formato.peso(pesoEmisor)),
      typeof otro !== "number" ? SOLO_EL_EMISOR : Math.abs(otro - pesoEmisor) < 0.0005 ? "Coincide" : `${formato.oFalta(formato.peso(otro))}, proveedor, ${dia(valorEn(cartera, "as_of"))}`
    ]);
  }

  /* Sin sección de costes, la comisión de swap se queda aquí: no se puede perder. */
  const swap = valorEn(datos, "costs.swap_fee");
  if (typeof swap === "number" && !bloques["declared/costs"]) {
    filas.push(["Comisión de swap", comisionDeSwap(swap), SOLO_EL_EMISOR]);
  }
  return filas;
}

function seccionDeLoQueDiceElEmisor(instrumento: InstrumentoDeLaBase): SeccionDeFicha | undefined {
  const datos = instrumento.bloques[SUFIJO_DATOS];
  const filas = filasDeLaComparacion(instrumento);
  if (filas.length === 0) return undefined;
  const nombre = nombreDelEmisor(datos);
  const esCesta = esCestaDeSustitucion(datos);
  const conTitulosDelProveedor = !esCesta && typeof valorEn(instrumento.bloques["declared/holdings"], "securities_count") === "number";
  return {
    id: "datos-emisor",
    titulo: "Lo que dice el emisor",
    ancha: true,
    procedencia: procedencia(`Publicado por ${nombre}`, valorEn(datos, "as_of")),
    filas: [],
    tabla: { columnas: ["Dato", `Según ${nombre}`, "Otra fuente"], filas, cifras: [] },
    nota:
      "No sustituye a lo que dice el resto de la ficha: cada cifra lleva su fuente y el asesor decide con cuál trabaja." +
      (esCesta ? " Un ETF sintético no compra lo que replica: estas posiciones son su cesta de sustitución." : "") +
      (conTitulosDelProveedor ? " El proveedor cuenta como títulos las acciones y los bonos, sin liquidez ni derivados." : "")
  };
}

/** La sección del valor liquidativo, que va junto al precio. `undefined` si este instrumento no tiene bloque del emisor. */
export function seccionDelEmisorJuntoAlPrecio(instrumento: InstrumentoDeLaBase): SeccionDeFicha | undefined {
  return instrumento.bloques[SUFIJO_DATOS] ? seccionDelValorLiquidativo(instrumento) : undefined;
}

/** La tabla con lo que dice el emisor frente a las demás fuentes. */
export function seccionAnchaDelEmisor(instrumento: InstrumentoDeLaBase): SeccionDeFicha | undefined {
  return instrumento.bloques[SUFIJO_DATOS] ? seccionDeLoQueDiceElEmisor(instrumento) : undefined;
}
