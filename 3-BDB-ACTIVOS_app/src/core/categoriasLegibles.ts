/**
 * El nombre con que se enseña la categoría de un fondo (decisiones 99, 100 y 101 de Óscar, 05-11-2026).
 *
 * Casi nada es traducción nuestra: el extractor pide cada fondo en español y Morningstar contesta, por ejemplo, «RV Global Cap.
 * Grande Growth»; después otra consulta lo pisa con «EAA Fund Global Large-Cap Growth Equity». Esta tabla devuelve el nombre
 * español del proveedor, con RV y RF como él los abrevia (99), «Cap. Grande» y «Bonos Alto Rendimiento» como él (100), y solo
 * retoca lo que escribe de varias formas para lo mismo. Cada fila está medida y razonada en
 * `docs/rediseno-2026-11/datos/categorias-2026-11-05.json`, y `tests/categoriasLegibles.test.ts` la compara con él fila a fila.
 *
 * Se traduce solo al enseñar: la base, el servidor y el extractor siguen con el texto del proveedor. Por eso lo que agrupa,
 * filtra o compara categorías lo hace por este nombre, y no por el texto: la misma categoría está en los dos idiomas (18 parejas),
 * y por el texto saldría dos veces.
 *
 * Por texto exacto, sin «contiene»: una regla de «contiene» escribía «Renta variable Japón» en los fondos que excluyen Japón. Lo
 * único que no cuenta son los espacios, porque el proveedor mete uno de no separación en «Cubierto EUR». Lo que no esté aquí sale
 * con el texto del proveedor, sin el prefijo «EAA Fund», hasta que se añada.
 */

/** La base nueva: las 145 categorías con nombre, por número de instrumentos. */
const DE_LA_BASE_NUEVA: ReadonlyArray<readonly [string, string]> = [
  ["EAA Fund EUR Ultra Short-Term Bond", "RF Ultra Corto Plazo EUR"],
  ["EAA Fund Global Large-Cap Growth Equity", "RV Global Cap. Grande Growth"],
  ["EAA Fund Europe Large-Cap Blend Equity", "RV Europa Cap. Grande Blend"],
  ["EAA Fund EUR Flexible Allocation - Global", "Mixtos Flexibles EUR - Global"],
  ["EAA Fund EUR Moderate Allocation - Global", "Mixtos Moderados EUR - Global"],
  ["EAA Fund Other Equity", "RV Otros"],
  ["EAA Fund Global Large-Cap Blend Equity", "RV Global Cap. Grande Blend"],
  ["EAA Fund Global Emerging Markets Equity", "RV Global Emergente"],
  ["EAA Fund Sector Equity Technology", "RV Sector Tecnología"],
  ["EAA Fund Asia ex-Japan Equity", "RV Asia (ex-Japón)"],
  ["EAA Fund EUR Diversified Bond - Short Term", "RF Diversificada Corto Plazo EUR"],
  ["EAA Fund Global Emerging Markets Bond - EUR Hedged", "RF Global Emergente - Sesgo EUR"],
  ["EAA Fund EUR Corporate Bond", "RF Deuda Corporativa EUR"],
  ["EAA Fund EUR Flexible Bond", "RF Flexible EUR"],
  ["EAA Fund EUR Aggressive Allocation - Global", "Mixtos Agresivos EUR - Global"],
  ["EAA Fund Europe Flex-Cap Equity", "RV Europa Cap. Flexible"],
  ["EAA Fund Global Flex-Cap Equity", "RV Global Cap. Flexible"],
  ["EAA Fund Global Small/Mid-Cap Equity", "RV Global Cap. Pequeña y Mediana"],
  ["EAA Fund Sector Equity Healthcare", "RV Sector Salud"],
  ["EAA Fund EUR Cautious Allocation", "Mixtos Defensivos EUR"],
  ["EAA Fund EUR Diversified Bond", "RF Diversificada EUR"],
  ["EAA Fund EUR Flexible Allocation", "Mixtos Flexibles EUR"],
  ["EAA Fund EUR High Yield Bond", "RF Bonos Alto Rendimiento EUR"],
  ["EAA Fund Europe Large-Cap Growth Equity", "RV Europa Cap. Grande Growth"],
  ["EAA Fund Global Large-Cap Value Equity", "RV Global Cap. Grande Value"],
  ["EAA Fund India Equity", "RV India"],
  ["EAA Fund Thematic Equity Alternative Energy", "RV Sector Energía Alternativa"],
  ["EAA Fund Thematic Equity Ecology", "RV Sector Ecología"],
  ["EAA Fund US Large-Cap Blend Equity", "RV USA Cap. Grande Blend"],
  ["EAA Fund EUR Cautious Allocation - Global", "Mixtos Defensivos EUR - Global"],
  ["EAA Fund Europe Large-Cap Value Equity", "RV Europa Cap. Grande Value"],
  ["EAA Fund Eurozone Large-Cap Equity", "RV Zona Euro Cap. Grande"],
  ["EAA Fund Global High Yield Bond - EUR Hedged", "RF Bonos Alto Rendimiento Global - EUR Cubierto"],
  ["EAA Fund Spain Equity", "RV España"],
  ["EAA Fund Europe Small-Cap Equity", "RV Europa Cap. Pequeña"],
  ["EAA Fund Fixed Term Bond", "RF Deuda a Plazo Fijo"],
  ["EAA Fund Global Equity Income", "RV Global Alto Dividendo"],
  ["EAA Fund Latin America Equity", "RV Latinoamérica"],
  ["EAA Fund China Equity", "RV China"],
  ["EAA Fund Global Flexible Bond - EUR Hedged", "RF Flexible Global - EUR Cubierto"],
  ["EAA Fund Global Inflation-Linked Bond - EUR Hedged", "RF Bonos Ligados Inflación Global - EUR Cubierto"],
  ["EAA Fund Sector Equity Natural Resources", "RV Sector Recursos Naturales"],
  ["EAA Fund Asia-Pacific ex-Japan Equity", "RV Asia Pacífico (ex-Japón)"],
  ["EAA Fund Japan Large-Cap Blend Equity", "RV Japón Cap. Grande Blend"],
  ["EAA Fund US Large-Cap Value Equity", "RV USA Cap. Grande Value"],
  ["EAA Fund USD Moderate Allocation", "Mixtos Moderados USD"],
  ["EAA Fund Europe Mid-Cap Equity", "RV Europa Cap. Mediana"],
  ["EAA Fund Sector Equity Consumer Goods & Services", "RV Sector Consumo"],
  ["EAA Fund Sector Equity Financial Services", "RV Sector Finanzas"],
  ["EAA Fund Sector Equity Precious Metals", "RV Sector Oro y Metales Preciosos"],
  ["EAA Fund Thematic Equity Infrastructure", "RV Sector Infraestructura"],
  ["EAA Fund Convertible Bond - Global, EUR Hedged", "RF Convertibles Global - EUR Cubierto"],
  ["EAA Fund EUR Money Market", "Mercado Monetario EUR"],
  ["EAA Fund Equity Market Neutral EUR", "Alternativo Market Neutral - RV EUR"],
  ["EAA Fund Europe Equity Income", "RV Europa Alto Dividendo"],
  ["EAA Fund Eurozone Mid-Cap Equity", "RV Zona Euro Cap. Mediana"],
  ["EAA Fund Global Emerging Markets Bond", "RF Global Emergente"],
  ["EAA Fund Multistrategy EUR", "Alternativo Multiestrategia EUR"],
  ["EAA Fund Other Bond", "RF Otros"],
  ["EAA Fund US Large-Cap Growth Equity", "RV USA Cap. Grande Growth"],
  ["EAA Fund Asia-Pacific Equity", "RV Asia Pacífico"],
  ["EAA Fund Brazil Equity", "RV Brasil"],
  ["EAA Fund EUR Corporate Bond - Short Term", "RF Deuda Corporativa Corto Plazo EUR"],
  ["EAA Fund EUR Moderate Allocation", "Mixtos Moderados EUR"],
  ["EAA Fund EUR Subordinated Bond", "RF Deuda Subordinada EUR"],
  ["EAA Fund Emerging Europe ex-Russia Equity", "RV Europa Emergente (ex-Rusia)"],
  ["EAA Fund Europe ex-UK Equity", "RV Europa (ex-Reino Unido)"],
  ["EAA Fund Global Diversified Bond - EUR Hedged", "RF Diversificada Global - EUR Cubierto"],
  ["EAA Fund Global Emerging Markets Corporate Bond", "RF Deuda Corporativa Global Emergente"],
  ["EAA Fund Global Flexible Bond", "RF Flexible Global"],
  ["EAA Fund Greater China Equity", "RV Gran China"],
  ["EAA Fund Japan Small/Mid-Cap Equity", "RV Japón Cap. Pequeña y Mediana"],
  ["EAA Fund Long/Short Equity - Europe", "RV Long/Short Europa"],
  ["EAA Fund Sector Equity Biotechnology", "RV Sector Biotecnología"],
  ["EAA Fund USD Aggressive Allocation", "Mixtos Agresivos USD"],
  ["RV Global Cap. Grande Blend", "RV Global Cap. Grande Blend"],
  ["RV USA Cap. Grande Blend", "RV USA Cap. Grande Blend"],
  ["RV Zona Euro Cap. Grande", "RV Zona Euro Cap. Grande"],
  ["EAA Fund EUR Bond - Long Term", "RF Largo Plazo EUR"],
  ["EAA Fund EUR Government Bond", "RF Deuda Pública EUR"],
  ["EAA Fund EUR Inflation-Linked Bond", "RF Bonos Ligados Inflación EUR"],
  ["EAA Fund EUR Money Market - Short Term", "Mercado Monetario Corto Plazo EUR"],
  ["EAA Fund Eurozone Flex-Cap Equity", "RV Zona Euro Cap. Flexible"],
  ["EAA Fund Eurozone Small-Cap Equity", "RV Zona Euro Cap. Pequeña"],
  ["EAA Fund Germany Equity", "RV Alemania"],
  ["EAA Fund Global Emerging Markets Bond - Local Currency", "RF Global Emergente - Moneda Local"],
  ["EAA Fund Global Emerging Markets Corporate Bond - EUR Hedged", "RF Deuda Corporativa Global Emergente - EUR Cubierto"],
  ["EAA Fund Taiwan Large-Cap Equity", "RV Taiwán Cap. Grande"],
  ["EAA Fund Thematic Equity Water", "RV Sector Agua"],
  ["EAA Fund UK Flex-Cap Equity", "RV Reino Unido Cap. Flexible"],
  ["EAA Fund US Small-Cap Equity", "RV USA Cap. Pequeña"],
  ["EAA Fund USD Flexible Bond", "RF Flexible USD"],
  ["EAA Fund USD High Yield Bond", "RF Bonos Alto Rendimiento USD"],
  ["RV Asia (ex-Japón)", "RV Asia (ex-Japón)"],
  ["RV Otros", "RV Otros"],
  ["RV Sector Finanzas", "RV Sector Finanzas"],
  ["EAA Fund ASEAN Equity", "RV ASEAN"],
  ["EAA Fund Asia ex-Japan Small/Mid-Cap Equity", "RV Asia (ex-Japón) Cap. Pequeña y Mediana"],
  ["EAA Fund Asia-Pacific ex-Japan Equity Income", "RV Asia Pacífico (ex-Japón) Alto Dividendo"],
  ["EAA Fund China Bond", "RF China"],
  ["EAA Fund Commodities - Broad Basket", "Materias Primas - Diversificado"],
  ["EAA Fund Commodities - Precious Metals", "Materias Primas - Metales Preciosos"],
  ["EAA Fund Convertible Bond - Europe", "RF Convertibles Europa"],
  ["EAA Fund Convertible Bond - Global", "RF Convertibles Global"],
  ["EAA Fund DKK Bond", "RF DKK"],
  ["EAA Fund Europe ex-UK Small/Mid-Cap Equity", "RV Europa (ex-Reino Unido) Cap. Pequeña y Mediana"],
  ["EAA Fund France Small/Mid-Cap Equity", "RV Francia Cap. Pequeña y Mediana"],
  ["EAA Fund Global Corporate Bond - EUR Hedged", "RF Deuda Corporativa Global - EUR Cubierto"],
  ["EAA Fund Global Diversified Bond", "RF Diversificada Global"],
  ["EAA Fund Global Emerging Markets Allocation", "Mixtos Global Emergente"],
  ["EAA Fund Global Flexible Bond - USD Hedged", "RF Flexible Global - USD Cubierto"],
  ["EAA Fund Global High Yield Bond", "RF Bonos Alto Rendimiento Global"],
  ["EAA Fund Global Short-Term Bond - EUR Hedged", "RF Corto Plazo Global - EUR Cubierto"],
  ["EAA Fund Italy Equity", "RV Italia"],
  ["EAA Fund Other Allocation", "Mixtos Otros"],
  ["EAA Fund Property - Indirect Europe", "Inmobiliario - Indirecto Europa"],
  ["EAA Fund Property - Indirect Eurozone", "Inmobiliario - Indirecto Zona Euro"],
  ["EAA Fund Property - Indirect Global", "Inmobiliario - Indirecto Global"],
  ["EAA Fund RMB Bond - Onshore", "RF RMB Local"],
  ["EAA Fund Sector Equity Energy", "RV Sector Energía"],
  ["EAA Fund Sector Equity Industrial Materials", "RV Sector Materiales Industriales"],
  ["EAA Fund Switzerland Equity", "RV Suiza"],
  ["EAA Fund Systematic Trend EUR", "Alternativo Futuros Gestionados EUR"],
  ["EAA Fund Target Date 2026 - 2030", "Fecha Objetivo 2026-2030"],
  ["EAA Fund Target Date 2031 - 2035", "Fecha Objetivo 2031-2035"],
  ["EAA Fund Thematic Equity Food", "RV Sector Agricultura"],
  ["EAA Fund UK Large-Cap Equity", "RV Reino Unido Cap. Grande"],
  ["EAA Fund US Equity Income", "RV USA Alto Dividendo"],
  ["EAA Fund USD Cautious Allocation", "Mixtos Defensivos USD"],
  ["EAA Fund USD Flexible Allocation", "Mixtos Flexibles USD"],
  ["Large Blend", "RV USA Cap. Grande Blend"],
  ["Large Growth", "RV USA Cap. Grande Growth"],
  ["Materias Primas - Metales Preciosos", "Materias Primas - Metales Preciosos"],
  ["Mercado Monetario Otros", "Mercado Monetario Otros"],
  ["RF Deuda Corporativa EUR", "RF Deuda Corporativa EUR"],
  ["RF Diversificada Global - Cubierto \u00a0EUR", "RF Diversificada Global - EUR Cubierto"],
  ["RV Asia Pacífico (ex-Japón)", "RV Asia Pacífico (ex-Japón)"],
  ["RV España", "RV España"],
  ["RV Europa Cap. Grande Blend", "RV Europa Cap. Grande Blend"],
  ["RV Europa Cap. Pequeña", "RV Europa Cap. Pequeña"],
  ["RV Japón Cap. Grande Blend", "RV Japón Cap. Grande Blend"],
  ["RV Latinoamérica", "RV Latinoamérica"],
  ["RV Sector Recursos Naturales", "RV Sector Recursos Naturales"],
  ["RV Sector Salud", "RV Sector Salud"],
  ["RV Sector Tecnología", "RV Sector Tecnología"],
];

/**
 * Las 7 que solo trae la base anterior. «accion» y «ETF» no son categorías: son el producto, en sus acciones y en 8 ETF.
 * La de una acción dice «Acciones», como manda la decisión 83, y no «Acción», que proponía la tabla.
 */
const SOLO_DE_LA_BASE_ANTERIOR: ReadonlyArray<readonly [string, string]> = [
  ["accion", "Acciones"],
  ["ETF", "ETF"],
  ["EAA Fund Sector Equity Alternative Energy", "RV Sector Energía Alternativa"],
  ["RF Ultra Corto Plazo EUR", "RF Ultra Corto Plazo EUR"],
  ["EAA Fund Sector Equity Ecology", "RV Sector Ecología"],
  ["Global", "Global"],
  ["Renta variable Asia ex Japon", "RV Asia (ex-Japón)"],
];

export const CATEGORIAS_LEGIBLES: ReadonlyArray<readonly [string, string]> = [...DE_LA_BASE_NUEVA, ...SOLO_DE_LA_BASE_ANTERIOR];

/** Los espacios no cuentan: ni los de más ni los de no separación. */
const sinEspaciosDeMas = (texto: string) => texto.replace(/\s+/g, " ").trim();

const POR_TEXTO = new Map(CATEGORIAS_LEGIBLES.map(([original, legible]) => [sinEspaciosDeMas(original), legible]));

const PREFIJO_DEL_PROVEEDOR = /^EAA\s+Fund\s+/i;

/** El nombre de una categoría tal como se enseña. Lo que no está en la tabla, con el texto del proveedor sin «EAA Fund». */
export function nombreDeCategoria(categoria: string): string {
  const texto = sinEspaciosDeMas(categoria);
  return POR_TEXTO.get(texto) ?? texto.replace(PREFIJO_DEL_PROVEEDOR, "");
}
