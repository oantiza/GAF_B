import { REGION } from "../../core/etiquetasDeReparto";
import type { Signo } from "../../core/formato";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import { MORNINGSTAR_REGIONS, ZONE_CHIP, type Macro } from "../../core/regionTaxonomy";
import type {
  CeldaDeSeccion,
  ClaseDeAusencia,
  FichaInstrumento,
  FilaDeFicha,
  SeccionDeFicha,
  Trozo
} from "../../types/fichaInstrumento";

/**
 * Dónde y cómo se enseña cada sección de la ficha (rediseño «Informe vivo», paso 4, 14-11-2026).
 *
 * La ficha la compone `componerFicha` a partir de lo que el instrumento declara, y eso no cambia: ni qué secciones salen ni
 * sus cifras. Lo que decide este fichero es la pestaña de cada sección (un mapa, en un solo sitio) y lo que se lee primero:
 * la banda de la respuesta y los bloques cortos del Resumen. **Todo sale de las secciones ya compuestas**, con sus mismos
 * textos: la banda no vuelve a leer la base ni a formatear una cifra, así que no puede decir otra cosa que la pestaña donde
 * está su detalle. Y no pregunta por el tipo de producto: un dato cuya sección no se compone no le aplica al activo y no
 * ocupa casilla; uno cuya sección sí está y no trae la cifra dice que falta.
 */

export const PESTANAS_DE_LA_FICHA = [
  { id: "resumen", label: "Resumen" },
  { id: "rentabilidad", label: "Rentabilidad y riesgo" },
  { id: "cartera", label: "Cartera" },
  { id: "fundamentales", label: "Fundamentales" },
  { id: "costes", label: "Costes" },
  { id: "documentos", label: "Documentos y datos" }
] as const;

export type PestanaDeLaFicha = (typeof PESTANAS_DE_LA_FICHA)[number]["id"];

export const IDS_DE_PESTANA_DE_LA_FICHA: readonly PestanaDeLaFicha[] = PESTANAS_DE_LA_FICHA.map((pestana) => pestana.id);

/** La pestaña de cada sección, por su identificador. Lo que no está aquí cae en «Documentos y datos». */
const PESTANA_DE_LA_SECCION: Record<string, Exclude<PestanaDeLaFicha, "resumen">> = {
  metricas: "rentabilidad",
  rentabilidad: "rentabilidad",
  riesgo: "rentabilidad",
  "contra-indice-propio": "rentabilidad",
  "contra-indice": "rentabilidad",
  regulatorio: "rentabilidad",
  precio: "rentabilidad",
  "vl-emisor": "rentabilidad",
  dividendos: "rentabilidad",
  rentas: "rentabilidad",
  composicion: "cartera",
  cartera: "cartera",
  "caja-de-estilo": "cartera",
  sectores: "cartera",
  regiones: "cartera",
  estilos: "cartera",
  tamanos: "cartera",
  valoracion: "fundamentales",
  "rentabilidad-emisor": "fundamentales",
  coste: "costes",
  objetivo: "documentos",
  perfil: "documentos",
  equity: "documentos",
  etf: "documentos",
  patrimonio: "documentos",
  "mercado-objetivo": "documentos",
  "datos-emisor": "documentos",
  calidad: "documentos"
};

export function pestanaDeLaSeccion(id: string): Exclude<PestanaDeLaFicha, "resumen"> {
  return PESTANA_DE_LA_SECCION[id] ?? "documentos";
}

/**
 * Las secciones que solo ve el asesor: las que `componerFicha` deja fuera en Modo cliente (la calidad, los datos del emisor y el
 * mercado objetivo). A la vista del asesor llevan el distintivo «Interno»; en Modo cliente ni se componen.
 */
export const SECCIONES_INTERNAS: ReadonlySet<string> = new Set(["calidad", "vl-emisor", "datos-emisor", "mercado-objetivo"]);

/** El signo de una cifra ya escrita: «+5,75 %» sube, «−9,08 %» baja; lo demás, sin color. */
export function signoDelTexto(texto: string): Signo {
  const limpio = texto.trim();
  if (limpio.startsWith("+")) return "sube";
  if (limpio.startsWith("−") || limpio.startsWith("-")) return "baja";
  return "neutro";
}

const seccionDe = (ficha: FichaInstrumento, id: string): SeccionDeFicha | undefined => ficha.secciones.find((seccion) => seccion.id === id);

const textoDe = (trozos: readonly Trozo[]): string => trozos.map((trozo) => trozo.texto).join("").trim();

/** «Del KID · 19 ago 2026» → «del KID · 19 ago 2026», para ir detrás de otra palabra. */
const enMinuscula = (texto: string): string => (/^[A-ZÁÉÍÓÚ][a-záéíóúñ]/.test(texto) ? texto.charAt(0).toLowerCase() + texto.slice(1) : texto);

/** El último tramo de una procedencia («Calculadas por nosotros · Mensual · a 6 nov 2026» → «a 6 nov 2026»), o nada si solo tiene uno. */
function ultimoTramo(trozos: readonly Trozo[]): string | undefined {
  const tramos = textoDe(trozos).split(" · ").map((tramo) => tramo.trim()).filter(Boolean);
  return tramos.length > 1 ? tramos[tramos.length - 1] : undefined;
}

/** La celda de una tabla de ventanas, por el principio del rótulo de su fila y el título de su columna. Una celda vacía no cuenta. */
function celdaDeLaTabla(seccion: SeccionDeFicha | undefined, fila: RegExp, columna: string): CeldaDeSeccion | undefined {
  const tabla = seccion?.tabla;
  if (!tabla) return undefined;
  const indice = tabla.columnas.indexOf(columna);
  if (indice < 1) return undefined;
  const encontrada = tabla.filas.find((celdas) => fila.test(String(celdas[0])));
  const celda = encontrada?.[indice];
  return celda === undefined || celda === "" ? undefined : celda;
}

const celdaDeLaFila = (fila: FilaDeFicha): CeldaDeSeccion => (fila.ausencia ? { texto: fila.valor, ausencia: fila.ausencia } : fila.valor);

/**
 * De cuándo es una cifra del proveedor. Su procedencia puede fechar solo algunas ventanas («3, 5 y 10 años a 31 oct 2026», decisión 114):
 * entonces una ventana que no nombra va sin fecha, como en su sección, y no con la de las otras.
 */
function apunteDelProveedor(tramo: string | undefined, ventana: string): string {
  if (!tramo) return "del proveedor";
  const porVentanas = /^(\d[\d, y]*) años? a (.+)$/.exec(tramo);
  if (!porVentanas) return `del proveedor · ${tramo}`;
  const numero = ventana.split(" ")[0];
  return porVentanas[1].split(/, | y /).includes(numero) ? `del proveedor · a ${porVentanas[2]}` : "del proveedor, sin fecha";
}

/** Un dato de la banda de la respuesta. El texto es el de la sección, tal cual. */
export interface DatoDeLaRespuesta {
  id: "precio" | "rentabilidad-1" | "rentabilidad-3" | "volatilidad-3" | "coste" | "riesgo";
  rotulo: string;
  valor: string;
  ausencia?: ClaseDeAusencia;
  /** Solo en una rentabilidad: el color del signo. */
  signo?: Signo;
  apunte?: string;
}

function datoDeCelda(
  id: DatoDeLaRespuesta["id"],
  rotulo: string,
  celda: CeldaDeSeccion,
  apunte: string | undefined,
  conSigno = false
): DatoDeLaRespuesta {
  if (typeof celda !== "string") return { id, rotulo, valor: celda.texto, ausencia: celda.ausencia, apunte };
  return { id, rotulo, valor: celda, apunte, ...(conSigno ? { signo: signoDelTexto(celda) } : {}) };
}

/**
 * Una rentabilidad o una volatilidad de la banda. Por ventana manda una sola fuente (decisión 110): la fila del proveedor solo
 * se compone cuando la nuestra no está, así que si hay fila del proveedor es esa, y si no, la celda de nuestra tabla.
 */
function datoDeVentana(
  ficha: FichaInstrumento,
  id: DatoDeLaRespuesta["id"],
  rotulo: string,
  {
    seccionDelProveedor,
    filaDelProveedor,
    filaNuestra,
    ventana,
    conSigno,
    apunteNuestro
  }: { seccionDelProveedor: string; filaDelProveedor: string; filaNuestra: RegExp; ventana: string; conSigno: boolean; apunteNuestro?: string }
): DatoDeLaRespuesta | null {
  const delProveedor = seccionDe(ficha, seccionDelProveedor);
  const fila = delProveedor?.filas.find((candidata) => candidata.rotulo === filaDelProveedor);
  if (delProveedor && fila) {
    return datoDeCelda(id, rotulo, celdaDeLaFila(fila), apunteDelProveedor(ultimoTramo(delProveedor.procedencia), ventana), conSigno);
  }
  const nuestras = seccionDe(ficha, "metricas");
  if (!nuestras) return null;
  const celda = celdaDeLaTabla(nuestras, filaNuestra, ventana);
  const tramo = ultimoTramo(nuestras.procedencia);
  if (celda !== undefined) return datoDeCelda(id, rotulo, celda, apunteNuestro ?? (tramo ? `calculada por nosotros · ${tramo}` : "calculada por nosotros"), conSigno);
  /* La sección de nuestras métricas está y no trae la cifra: le aplica y falta, y su procedencia dice por qué. */
  return { id, rotulo, valor: "Falta el dato", ausencia: "falta", apunte: textoDe(nuestras.procedencia) || undefined };
}

/** Lo que pide la banda y en este orden. */
const ORDEN: Array<{ id: DatoDeLaRespuesta["id"]; rotulo: string }> = [
  { id: "precio", rotulo: "Valor liquidativo" },
  { id: "rentabilidad-1", rotulo: "Rentabilidad 1 año" },
  { id: "rentabilidad-3", rotulo: "Rentabilidad anualizada 3 años" },
  { id: "volatilidad-3", rotulo: "Volatilidad 3 años" },
  { id: "coste", rotulo: "Coste corriente" },
  { id: "riesgo", rotulo: "Riesgo (SRI)" }
];

/**
 * La banda de la respuesta: valor liquidativo (o precio), rentabilidad a 1 y a 3 años, volatilidad a 3 años, coste corriente y
 * riesgo. Entre tres y seis datos: si el activo tiene menos de tres que le apliquen, se completan con «Falta el dato» en el
 * mismo orden, para que la banda no se quede en una cifra suelta.
 */
export function respuestaDeLaFicha(ficha: FichaInstrumento): DatoDeLaRespuesta[] {
  const datos: DatoDeLaRespuesta[] = [];

  const precio = seccionDe(ficha, "precio");
  const filaDelPrecio = precio?.filas.find((fila) => fila.destacada) ?? precio?.filas[0];
  if (precio && filaDelPrecio) {
    const rotulo = filaDelPrecio.rotulo === "Valor liquidativo" ? "Valor liquidativo" : "Precio";
    datos.push(datoDeCelda("precio", rotulo, celdaDeLaFila(filaDelPrecio), ultimoTramo(precio.procedencia)));
  }

  const unAno = datoDeVentana(ficha, "rentabilidad-1", "Rentabilidad 1 año", {
    seccionDelProveedor: "rentabilidad",
    filaDelProveedor: "1 año",
    filaNuestra: /^Rentabilidad/,
    ventana: "1 año",
    conSigno: true
  });
  if (unAno) datos.push(unAno);

  const tresAnos = datoDeVentana(ficha, "rentabilidad-3", "Rentabilidad anualizada 3 años", {
    seccionDelProveedor: "rentabilidad",
    filaDelProveedor: "3 años",
    filaNuestra: /^Rentabilidad/,
    ventana: "3 años",
    conSigno: true
  });
  if (tresAnos) datos.push(tresAnos);

  const caida = celdaDeLaTabla(seccionDe(ficha, "metricas"), /^Caída máxima/, "3 años");
  const volatilidad = datoDeVentana(ficha, "volatilidad-3", "Volatilidad 3 años", {
    seccionDelProveedor: "riesgo",
    filaDelProveedor: "Volatilidad 3 años",
    filaNuestra: /^Volatilidad/,
    ventana: "3 años",
    conSigno: false,
    apunteNuestro: typeof caida === "string" ? `caída máxima, ${caida}` : undefined
  });
  if (volatilidad) datos.push(volatilidad);

  const coste = seccionDe(ficha, "coste");
  const filaDelCoste = coste?.filas.find((fila) => fila.rotulo === "Coste corriente");
  if (coste && filaDelCoste) {
    const procedencia = textoDe(coste.procedencia);
    datos.push(datoDeCelda("coste", "Coste corriente", celdaDeLaFila(filaDelCoste), procedencia ? `al año · ${enMinuscula(procedencia)}` : "al año"));
  }

  const regulatorio = seccionDe(ficha, "regulatorio");
  const filaDelSri = regulatorio?.filas.find((fila) => fila.rotulo.startsWith("SRI"));
  if (regulatorio && filaDelSri) {
    /* La procedencia del indicador habla también del SRRI; aquí solo cuenta la del SRI. */
    const delSri = textoDe(regulatorio.procedencia.filter((trozo) => !trozo.texto.includes("SRRI")));
    const celda: CeldaDeSeccion = filaDelSri.ausencia || /de 7$/.test(filaDelSri.valor) ? celdaDeLaFila(filaDelSri) : `${filaDelSri.valor} de 7`;
    datos.push(datoDeCelda("riesgo", "Riesgo (SRI)", celda, delSri ? enMinuscula(delSri) : undefined));
  }

  for (const { id, rotulo } of ORDEN) {
    if (datos.length >= 3) break;
    if (!datos.some((dato) => dato.id === id)) datos.push({ id, rotulo, valor: "Falta el dato", ausencia: "falta" });
  }
  return ORDEN.flatMap(({ id }) => datos.filter((dato) => dato.id === id));
}

/** Las ventanas de la tabla de rentabilidades del Resumen, en este orden. */
const VENTANAS_DEL_RESUMEN = ["En el año", "1 año", "3 años", "5 años", "10 años"] as const;

/**
 * El título de cada ventana en el Resumen, si no es el de la ventana. La del año se llama «YTD», como en las tablas, la
 * ficha y Planes desde el 17-11-2026 (Óscar; en el Resumen, el 20-11-2026). La ventana conserva su nombre de siempre
 * porque es el rótulo con que la sección del proveedor escribe su fila.
 */
const TITULO_EN_EL_RESUMEN: Partial<Record<(typeof VENTANAS_DEL_RESUMEN)[number], string>> = {
  "En el año": "YTD"
};

/**
 * Con qué nombres puede venir cada ventana en la tabla de nuestras métricas. La del año se llama «YTD» allí desde el
 * 17-11-2026 (`conColumnaDelAnio`) y antes «En el año»: el Resumen la busca con los dos.
 */
const COLUMNAS_DE_LA_VENTANA: Partial<Record<(typeof VENTANAS_DEL_RESUMEN)[number], readonly string[]>> = {
  "En el año": ["En el año", "YTD"]
};

/** Por qué no hay cifra a 10 años cuando la serie no llega: se dice bajo el «No aplica» (F3, Óscar, 21-11-2026). */
export const MOTIVO_SIN_DIEZ_ANOS = "La serie no llega a 10 años";

/**
 * La fila de rentabilidades por periodo del Resumen: por ventana, la del proveedor si se compuso (solo se compone donde no está
 * la nuestra) y si no, la de nuestra tabla. Las mismas celdas que la pestaña «Rentabilidad y riesgo», sin escribir ninguna.
 *
 * La columna de 10 años sale siempre (F3, Óscar, 21-11-2026): lo que falta se dice, no se esconde. Sin cifra de nadie,
 * «No aplica» con su motivo si nuestra tabla está calculada y no llega a esa ventana —la misma lectura que su «Sin
 * historia»: sin rentabilidad a 10 años, la serie no llega—, y «Falta el dato» si no hay tabla nuestra con que saberlo.
 */
export function rentabilidadesDelResumen(
  ficha: FichaInstrumento
): { columnas: string[]; celdas: CeldaDeSeccion[]; motivos: (string | undefined)[] } | null {
  const delProveedor = seccionDe(ficha, "rentabilidad");
  const nuestras = seccionDe(ficha, "metricas");
  const columnas: string[] = [];
  const celdas: CeldaDeSeccion[] = [];
  const motivos: (string | undefined)[] = [];
  for (const ventana of VENTANAS_DEL_RESUMEN) {
    const fila = delProveedor?.filas.find((candidata) => candidata.rotulo === ventana);
    const nuestraSuelta = ventana === "En el año" ? nuestras?.filas.find((candidata) => candidata.rotulo === "En el año") : undefined;
    const deNuestraTabla = (COLUMNAS_DE_LA_VENTANA[ventana] ?? [ventana])
      .map((columna) => celdaDeLaTabla(nuestras, /^Rentabilidad/, columna))
      .find((candidata) => candidata !== undefined);
    const celda = fila ? celdaDeLaFila(fila) : (deNuestraTabla ?? (nuestraSuelta ? celdaDeLaFila(nuestraSuelta) : undefined));
    if (celda === undefined && ventana === "10 años" && columnas.length > 0) {
      const sinLaVentana = nuestras?.tabla !== undefined && !nuestras.tabla.columnas.includes(ventana);
      columnas.push(ventana);
      celdas.push(
        sinLaVentana
          ? { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }
          : { texto: textoDeAusencia("falta"), ausencia: "falta" }
      );
      motivos.push(sinLaVentana ? MOTIVO_SIN_DIEZ_ANOS : undefined);
      continue;
    }
    if (celda === undefined) continue;
    columnas.push(TITULO_EN_EL_RESUMEN[ventana] ?? ventana);
    celdas.push(celda);
    motivos.push(undefined);
  }
  return columnas.length > 0 ? { columnas, celdas, motivos } : null;
}

/** Una parte de un reparto de la ficha, lista para `ListaDePartes`: su nombre, su fracción y, si la tiene, su color. */
export interface ParteDeLaFicha {
  nombre: string;
  fraccion: number;
  apunte?: string;
  color?: string;
  apagada?: boolean;
}

/** La clave de cada región por su rótulo en pantalla («Eurozona» → `eurozone`): la ficha recibe el rótulo, no la clave. */
const CLAVE_DE_LA_REGION: ReadonlyMap<string, string> = new Map(Object.entries(REGION).map(([clave, rotulo]) => [rotulo, clave]));

/** La zona del mapa de cada clave de región (`eurozone` → `emea`), de la taxonomía del mapa: la misma correspondencia que pinta el mapa. */
const ZONA_DE_LA_CLAVE: ReadonlyMap<string, Macro> = new Map(
  MORNINGSTAR_REGIONS.flatMap((grupo) => grupo.rows.flatMap((fila) => fila.keys.map((clave) => [clave, grupo.macro] as const)))
);

/**
 * El color de una región de la ficha: el de su zona en el mapa (`ZONE_CHIP`: América azul, Europa / O. Medio / África
 * latón, Asia verde salvia), el mismo en todas las pantallas. Lo que no está en ninguna zona («Sin zona») no tiene color.
 */
export function zonaDeLaRegion(rotulo: string): Macro | undefined {
  const clave = (CLAVE_DE_LA_REGION.get(rotulo) ?? rotulo).toLowerCase().replace(/[\s-]+/g, "_");
  return ZONA_DE_LA_CLAVE.get(clave);
}

/**
 * El color de una parte según la sección de la que sale (14-11-2026, Óscar: «le faltan colores en general»): una región, el
 * de su zona; lo que no tiene zona, apagado. Sectores, estilo y tamaño van en el marino de la pieza: sus partes no son
 * categorías con color propio.
 */
function colorDeLaParte(idDeSeccion: string, rotulo: string): Pick<ParteDeLaFicha, "color" | "apagada"> {
  if (idDeSeccion !== "regiones") return {};
  const zona = zonaDeLaRegion(rotulo);
  return zona ? { color: ZONE_CHIP[zona] } : { apagada: true };
}

/** «de la cual emergente» es una parte de la fila de encima, no otra parte del todo. */
const esUnaParteDeLaDeEncima = (fila: FilaDeFicha) => fila.rotulo.startsWith("de la cual");

/** Las secciones que son un reparto y, cuando sus filas traen su peso en número, se pintan como partes con su barra. */
const SECCIONES_DE_PARTES: ReadonlySet<string> = new Set(["regiones", "sectores", "estilos", "tamanos"]);

/**
 * Las filas de una sección de reparto, como partes de un todo con su barra (pestaña «Cartera»), o `null` si la sección no es
 * de reparto o alguna fila no trae su peso en número: entonces se pinta en filas, como siempre, y nada se lee de un texto ya
 * escrito. La cifra es la misma (un decimal), el rótulo y la glosa también; «de la cual emergente» va como apunte de su zona.
 *
 * La Composición no entra: sus filas no traen el peso en número, y dárselo haría que el papel de la ficha también le
 * dibujase la barra (`fichaDeActivoPdf`), que es otro medio.
 */
export function partesDeLaSeccion(seccion: SeccionDeFicha): ParteDeLaFicha[] | null {
  if (!SECCIONES_DE_PARTES.has(seccion.id) || seccion.filas.length === 0) return null;
  if (seccion.filas.some((fila) => typeof fila.peso !== "number" || !Number.isFinite(fila.peso) || fila.ausencia || fila.larga)) return null;
  const partes: ParteDeLaFicha[] = [];
  for (const fila of seccion.filas) {
    const anterior = partes[partes.length - 1];
    if (esUnaParteDeLaDeEncima(fila) && anterior) {
      anterior.apunte = [anterior.apunte, `${fila.rotulo}, ${fila.valor}`].filter(Boolean).join(" · ");
      continue;
    }
    partes.push({
      nombre: fila.rotulo,
      fraccion: fila.peso as number,
      ...(fila.glosa ? { apunte: fila.glosa } : {}),
      ...colorDeLaParte(seccion.id, fila.rotulo)
    });
  }
  return partes;
}

/** Las primeras partes del reparto para «En qué invierte»: las regiones y, sin ellas, los sectores. Con el color de su sección. */
export function partesDelResumen(
  ficha: FichaInstrumento,
  cuantas = 5
): { seccion: SeccionDeFicha; partes: ParteDeLaFicha[]; total: number } | null {
  for (const id of ["regiones", "sectores"]) {
    const seccion = seccionDe(ficha, id);
    const filas = (seccion?.filas ?? []).filter((fila) => typeof fila.peso === "number" && !esUnaParteDeLaDeEncima(fila));
    if (seccion && filas.length > 0) {
      return {
        seccion,
        partes: filas
          .slice(0, cuantas)
          .map((fila) => ({ nombre: fila.rotulo, fraccion: fila.peso as number, ...colorDeLaParte(id, fila.rotulo) })),
        total: filas.length
      };
    }
  }
  return null;
}

/** Las filas de «Lo que cuesta»: el coste corriente y las comisiones que el inversor ve, de la sección de costes. */
const FILAS_DE_LO_QUE_CUESTA = ["Coste corriente", "Comisión de gestión", "Comisión de entrada (suscripción)", "Comisión de éxito"];

export function costesDelResumen(ficha: FichaInstrumento): { seccion: SeccionDeFicha; filas: FilaDeFicha[] } | null {
  const seccion = seccionDe(ficha, "coste");
  if (!seccion) return null;
  const filas = FILAS_DE_LO_QUE_CUESTA.flatMap((rotulo) => seccion.filas.filter((fila) => fila.rotulo === rotulo));
  return filas.length > 0 ? { seccion, filas } : null;
}

/** El objetivo, recortado por una palabra entera, para «El fondo, en una frase». */
export function objetivoDelResumen(
  ficha: FichaInstrumento,
  largo = 240
): { seccion: SeccionDeFicha; texto: string; recortado: boolean } | null {
  const seccion = seccionDe(ficha, "objetivo");
  const prosa = seccion?.prosa?.trim();
  if (!seccion || !prosa) return null;
  if (prosa.length <= largo) return { seccion, texto: prosa, recortado: false };
  const corte = prosa.lastIndexOf(" ", largo);
  return { seccion, texto: `${prosa.slice(0, corte > 0 ? corte : largo).replace(/[\s,;:.]+$/, "")}…`, recortado: true };
}

/** «FONDO DE INVERSIÓN» → «Fondo de inversión»; una sigla («ETF», «ETC») se queda como está. */
export function tipoEnFrase(tipo: string): string {
  if (tipo.length <= 3) return tipo;
  const minusculas = tipo.toLocaleLowerCase("es");
  return minusculas.charAt(0).toLocaleUpperCase("es") + minusculas.slice(1);
}

/** La política de reparto, si el perfil o las rentas la traen: «Acumulación» o «Reparto», para la línea de identidad. */
export function politicaDeReparto(ficha: FichaInstrumento): string | undefined {
  for (const [id, rotulo] of [
    ["perfil", "Política de reparto"],
    ["rentas", "Política declarada"]
  ] as const) {
    const fila = seccionDe(ficha, id)?.filas.find((candidata) => candidata.rotulo === rotulo);
    if (fila && !fila.ausencia) return fila.valor;
  }
  return undefined;
}
