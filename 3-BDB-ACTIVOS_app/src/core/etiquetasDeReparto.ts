/**
 * Las claves con que la base nueva nombra un reparto, en castellano.
 *
 * Un solo sitio para las tres pantallas que las enseñan —la ficha, el buscador y la
 * radiografía—, porque tenerlas por duplicado es tenerlas distintas: el 02-11-2026
 * llegué a escribir `asia_developed`, `japan` y `africa_middle_east`, que no existen,
 * mientras las reales eran `asia`, `middle_east` y `europe_emerging`. En pantalla eso
 * se veía como «asia» y «middle_east» en crudo entre nombres traducidos.
 *
 * **Medidas sobre las 1.076 tarjetas**, no supuestas. Lo que no esté aquí se enseña tal
 * cual viene: inventar el nombre de una región o de un sector es inventar.
 */
import { nombreDeCategoria } from "./categoriasLegibles";

/**
 * Una palabra por concepto: «Liquidez», «Materiales» y «Financieras» son las que ya escriben el informe de
 * cliente y `core/labels`, que no se puede tocar porque lo leen los PDF. Aquí se escribía «Efectivo» y
 * «Servicios financieros», y el mismo cliente leía las dos según la pantalla.
 */

/** `exposure.asset_mix`: cuatro claves. */
export const CLASE_DE_ACTIVO: Record<string, string> = {
  equity: "Renta variable",
  fixed_income: "Renta fija",
  cash: "Liquidez",
  other: "Otros"
};

/** `exposure.sectors` y el sector de un fondo: once claves. */
export const SECTOR_DEL_REPARTO: Record<string, string> = {
  basic_materials: "Materiales",
  communication_services: "Comunicación",
  consumer_cyclical: "Consumo cíclico",
  consumer_defensive: "Consumo defensivo",
  energy: "Energía",
  financial_services: "Financieras",
  healthcare: "Salud",
  industrials: "Industriales",
  real_estate: "Inmobiliario",
  technology: "Tecnología",
  utilities: "Utilities"
};

/**
 * `exposure.equity_regions`: las de la forma antigua y las cinco que trae la nueva (decisión 7). «other» no tiene
 * nombre aquí: no es una zona, `zonasDeUnReparto` la quita, y lo que de verdad queda sin zona se llama por lo que es.
 */
export const REGION: Record<string, string> = {
  africa: "África",
  asia: "Asia",
  asia_developed: "Asia desarrollada",
  asia_emerging: "Asia emergente",
  australasia: "Australasia",
  canada: "Canadá",
  europe_emerging: "Europa emergente",
  europe_ex_euro: "Europa no euro",
  eurozone: "Eurozona",
  japan: "Japón",
  latin_america: "Latinoamérica",
  middle_east: "Oriente Medio",
  sin_zona: "Sin zona",
  united_kingdom: "Reino Unido",
  united_states: "Estados Unidos"
};

/** `exposure.equity_styles` y `exposure.market_caps`: tres y tres. */
export const ESTILO_Y_TAMANO: Record<string, string> = {
  blend: "Mixto",
  growth: "Crecimiento",
  value: "Valor",
  large: "Grande",
  mid: "Mediana",
  small: "Pequeña"
};

/** El sector de una acción llega en inglés y con mayúsculas, no en clave. */
export const SECTOR_EN_INGLES: Record<string, string> = {
  "Basic Materials": "Materiales",
  "Communication Services": "Comunicación",
  "Consumer Cyclical": "Consumo cíclico",
  "Consumer Defensive": "Consumo defensivo",
  Energy: "Energía",
  "Financial Services": "Financieras",
  Healthcare: "Salud",
  Industrials: "Industriales",
  "Real Estate": "Inmobiliario",
  Technology: "Tecnología",
  Utilities: "Utilities"
};

const TODAS: Record<string, string> = {
  ...CLASE_DE_ACTIVO,
  ...SECTOR_DEL_REPARTO,
  ...REGION,
  ...ESTILO_Y_TAMANO
};

/**
 * Una palabra para cada cosa (decisión 66 de Óscar, 05-11-2026): lo que no consta de un reparto es «No declarado», en pantalla y en
 * papel; lo que el dato nombra y el mapa no sabe a qué zona lleva, un país suelto o «Global», es «Sin situar». Y una acción no tiene
 * categoría de fondo: es una acción, traiga «accion» como la base vieja o nada como la nueva.
 */
export const NO_DECLARADO = "No declarado";
export const SIN_SITUAR = "Sin situar";
/** La categoría de una acción, en su línea y en el reparto que las suma: una sola palabra, la de la decisión 83. */
export const CATEGORIA_DE_UNA_ACCION = "Acciones";

/** La etiqueta de una clave de reparto, o la clave misma si no la conocemos. */
export function etiquetaDeReparto(clave: string): string {
  return TODAS[clave] ?? clave;
}

/**
 * La categoría de un activo tal como se enseña, en pantalla y en papel: el nombre de la tabla de Óscar (decisiones 99 a 101,
 * `categoriasLegibles.ts`) y, lo que no está en ella, el texto del proveedor sin «EAA Fund». Lo que agrupa, filtra o compara categorías lo
 * hace por lo que devuelve esta función, para que la misma categoría en dos idiomas no salga dos veces. La base anterior guarda «accion»,
 * sin tilde ni mayúscula, en sus acciones: su categoría es «Acciones».
 */
export function categoriaLegible(categoria: string | null | undefined): string | undefined {
  if (!categoria?.trim()) return undefined;
  /* Sin tilde y en cualquier caja: `readableBackendLabel` la devuelve como «Accion». */
  return /^acci[oó]n$/i.test(categoria.trim()) ? CATEGORIA_DE_UNA_ACCION : nombreDeCategoria(categoria);
}

/**
 * La región principal de un activo llega en inglés. Medido el 05-11-2026 sobre los 1.097 activos de la base local:
 * estas son todas las que hay. Lo que no esté aquí se enseña tal cual: inventar el nombre de una región es inventar.
 */
const REGION_PRINCIPAL: Record<string, string> = {
  Australia: "Australia",
  Asia: "Asia",
  Canada: "Canadá",
  Emerging: "Emergentes",
  Europe: "Europa",
  Eurozone: "Eurozona",
  France: "Francia",
  Germany: "Alemania",
  Global: "Global",
  Iberia: "Iberia",
  Ireland: "Irlanda",
  Italy: "Italia",
  Japan: "Japón",
  LatAm: "Latinoamérica",
  Luxembourg: "Luxemburgo",
  Netherlands: "Países Bajos",
  Singapore: "Singapur",
  Spain: "España",
  Switzerland: "Suiza",
  USA: "Estados Unidos",
  "United Kingdom": "Reino Unido"
};

export function regionLegible(region: string): string {
  return REGION_PRINCIPAL[region] ?? region;
}
