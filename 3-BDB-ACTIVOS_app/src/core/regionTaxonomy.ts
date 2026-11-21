// Taxonomía geográfica estilo Morningstar: 3 macro-grupos con subregiones finas.
// Fuente única para la tabla (pantalla + PDF) y para colorear el mapa por macro-zona.

export interface RegionTaxRow {
  label: string;
  keys: string[];
}
export interface RegionTaxGroup {
  label: string;
  /** Macro-zona para colorear el mapa. */
  macro: "america" | "emea" | "asia";
  rows: RegionTaxRow[];
}

/**
 * «Iberia» y «Europe» son las regiones que traen las acciones de la base local (medido el 05-11-2026): ninguna de las
 * finas. Iberia es zona euro; de «Europe» se sabe la zona y no el detalle, y por eso tiene su propia fila. «asia» es el
 * total de Asia de la forma antigua del dato: tampoco tiene detalle, y hasta el 05-11-2026 salía rotulado «Asia -
 * Emergente», con el 8,3 % de Asia de un índice de países desarrollados dentro.
 */
export const MORNINGSTAR_REGIONS: RegionTaxGroup[] = [
  {
    label: "América",
    macro: "america",
    rows: [
      { label: "Estados Unidos", keys: ["united_states", "usa", "us", "north_america_us"] },
      { label: "Canadá", keys: ["canada"] },
      { label: "Iberoamérica", keys: ["latin_america", "iberoamerica", "south_america", "central_america"] }
    ]
  },
  {
    label: "Europa / O. Medio / África",
    macro: "emea",
    rows: [
      { label: "Reino Unido", keys: ["united_kingdom", "uk"] },
      { label: "Zona Euro", keys: ["eurozone", "euro_zone", "euro", "iberia"] },
      { label: "Europa - ex Euro", keys: ["europe_ex_euro", "europe_exeuro", "europe_ex_eur"] },
      { label: "Europa emergente", keys: ["europe_emerging", "emerging_europe"] },
      { label: "Oriente Medio / África", keys: ["middle_east", "africa", "africa_middle_east", "middle_east_africa", "africa_me", "emea_other"] },
      { label: "Europa, sin desglose", keys: ["europe"] }
    ]
  },
  {
    label: "Asia",
    macro: "asia",
    rows: [
      { label: "Japón", keys: ["japan"] },
      { label: "Australasia", keys: ["australasia", "australia", "oceania"] },
      { label: "Asia - Desarrollada", keys: ["asia_developed", "developed_asia", "asia_developed_ex_japan"] },
      { label: "Asia - Emergente", keys: ["asia_emerging", "emerging_asia", "greater_china", "china", "india"] },
      { label: "Asia, sin desglose", keys: ["asia"] }
    ]
  }
];

export interface RegionTableRow {
  label: string;
  value: number;
  /** true = fila de macro-grupo (subtotal, en negrita). */
  group: boolean;
  macro?: "america" | "emea" | "asia";
}

const norm = (k: string) => (k || "").toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Lo que dice la nota mientras el dato venga en la forma antigua: esa parte de la renta variable no está en
 * ninguna zona, y lo demás se ha repartido sin ella.
 */
export const NOTA_CANADA_Y_AFRICA = "Canadá y África aún no se separan";

/** Las claves que solo existen en la forma nueva del dato: el extractor las mandaba a «other» o al total de Asia. */
const SOLO_EN_LA_FORMA_NUEVA = new Set(["canada", "africa", "japan", "australasia", "asia_developed"]);

export interface ZonasDeUnReparto {
  /** Lo que se reparte: cada zona una sola vez, con la clave con la que viene. */
  zonas: Record<string, number>;
  /** Forma antigua: la parte emergente del total de Asia. Es un «de la cual», no otra zona. `null` si no viene. */
  asiaEmergenteDentroDeAsia: number | null;
  /** Forma antigua con «other»: hay Canadá y África que no se pueden situar, y no se cuentan. */
  canadaYAfricaSinSeparar: boolean;
  /** Forma nueva: lo que trae «other» ya no repite nada, así que de verdad no tiene zona. */
  sinZona: number;
}

/**
 * El reparto por regiones de UN instrumento, tal como viene de la base, sin contar nada dos veces.
 *
 * **Forma antigua** (la base vieja y la nube hasta que se suba otra pasada): «asia» es el total de Asia y
 * «asia_emerging» es parte de él; «other» lleva Canadá y África, que el extractor mandaba ahí, más una clave del
 * proveedor que repite el total de emergentes. Por eso un fondo de la India llega como «Asia 100, Asia emergente 100,
 * Otras 100»: cuenta tres veces lo mismo. Ni «asia_emerging» ni «other» cuentan.
 *
 * **Forma nueva** (la próxima pasada del extractor): Japón, Australasia, Asia desarrollada, Asia emergente, Canadá y
 * África con su nombre, sin el total de Asia y sin el «other» repetido. Si aun así viene un «other», no repite nada:
 * es una parte sin zona, y se dice.
 *
 * Cómo se distingue: «asia_emerging» sin «asia» solo existe en la forma nueva, y un «other» sin ninguna clave de la
 * forma nueva es de la antigua, también en un fondo sin nada en Asia (Latinoamérica 100, Otras 100: 68 en la base
 * vieja, medido el 05-11-2026). Se decide instrumento a instrumento: durante una subida parcial conviven las dos.
 */
export function zonasDeUnReparto(reparto: Readonly<Record<string, number>> | null | undefined): ZonasDeUnReparto {
  const entradas = Object.entries(reparto ?? {}).filter(([, peso]) => typeof peso === "number" && peso > 0);
  const claves = new Set(entradas.map(([clave]) => norm(clave)));
  const formaNueva = [...SOLO_EN_LA_FORMA_NUEVA].some((clave) => claves.has(clave));

  const zonas: Record<string, number> = {};
  let otras = 0;
  let asiaEmergenteDentroDeAsia: number | null = null;
  for (const [clave, peso] of entradas) {
    const normalizada = norm(clave);
    if (normalizada === "other") otras += peso;
    else if (normalizada === "asia_emerging" && claves.has("asia")) asiaEmergenteDentroDeAsia = peso;
    else zonas[clave] = peso;
  }
  return {
    zonas,
    asiaEmergenteDentroDeAsia,
    canadaYAfricaSinSeparar: otras > 0 && !formaNueva,
    sinZona: formaNueva ? otras : 0
  };
}

/**
 * Construye la tabla jerárquica (grupo + subregiones) desde filas {key, weight_percent},
 * más el total por macro-zona (para el mapa) y el residual que no se sabe situar.
 */
export function buildRegionTable(rows: readonly { key: string; weight_percent: number }[]): {
  table: RegionTableRow[];
  macroTotals: Record<"america" | "emea" | "asia", number>;
  other: number;
} {
  const byKey = new Map<string, number>();
  for (const r of rows) byKey.set(norm(r.key), (byKey.get(norm(r.key)) || 0) + (r.weight_percent || 0));

  const used = new Set<string>();
  const table: RegionTableRow[] = [];
  const macroTotals = { america: 0, emea: 0, asia: 0 };

  for (const g of MORNINGSTAR_REGIONS) {
    const sub: RegionTableRow[] = [];
    let gt = 0;
    for (const row of g.rows) {
      let v = 0;
      for (const k of row.keys) {
        if (byKey.has(k)) {
          v += byKey.get(k) as number;
          used.add(k);
        }
      }
      sub.push({ label: row.label, value: v, group: false });
      gt += v;
    }
    macroTotals[g.macro] = gt;
    table.push({ label: g.label, value: gt, group: true, macro: g.macro });
    for (const s of sub) table.push(s);
  }

  let other = 0;
  byKey.forEach((v, k) => {
    if (!used.has(k)) other += v;
  });
  return { table, macroTotals, other };
}

// --- Las tres macro-zonas del mapa y su nombre ---

export type Macro = "america" | "emea" | "asia";

export const ZONE_LABEL: Record<Macro, string> = {
  america: "América",
  emea: "Europa / O. Medio / África",
  asia: "Asia"
};

/**
 * El color de cada zona en el mapa: un tono por zona y cuatro intensidades por peso (claro → oscuro, por tramo).
 *
 * Vuelve el 14-11-2026 por decisión de Óscar («en el mapa de distribución geográfica, imprescindibles»). El rediseño lo
 * había dejado en una sola tinta (ANA-03), porque América llevaba el tono de la cartera y Europa el de la primera serie;
 * en el mapa no hay series que confundir, y una zona se reconoce antes por su color que por su claridad.
 *
 * Solo pantalla: los PDF tienen los suyos en `reports/paletaDelPapel.ts`. Desde la dirección A (18-11-2026, elegidos
 * por Óscar sobre el mapa) son las familias del azul de la renta variable (América), del latón (Europa / O. Medio /
 * África) y del verde salvia de la renta fija (Asia), en cuatro intensidades de más clara a plena. El tramo más claro de
 * cada zona da sobre el papel 2,78:1 (América), 2,00:1 (Europa / O. Medio / África) y 2,30:1 (Asia), WCAG 2.x.
 *
 * Pasados por el validador de `dataviz` el 18-11-2026 (distancia OKLab ×100, simulación Machado 2009, fondo blanco;
 * listones: 15 en visión normal, 8 con daltonismo, 6-8 solo con rótulo), los tres colores plenos separan peor que los
 * de antes (21,5 o más en visión normal, 11,8 o más con daltonismo): América/Asia da 13,1 en visión normal, bajo el
 * listón de 15, y 12,7 con daltonismo; Europa-OM-África/Asia, 13,4 en visión normal y 7,4 con protanopía, en la banda
 * que pide rótulo; América/Europa, 24,1 y 20,0. Por eso cada zona lleva siempre su nombre y su peso en la leyenda y en
 * la tabla.
 */
const ZONE_RAMPS: Record<Macro, [string, string, string, string]> = {
  america: ["#829EB9", "#6789AA", "#4A7299", "#2F5D8A"],
  emea: ["#CBB492", "#BFA47B", "#B39262", "#A8824A"],
  asia: ["#95B1A6", "#7EA092", "#658E7D", "#4E7D6A"]
};

/** El color pleno de cada zona: la marca de la leyenda y el punto de la tabla. */
export const ZONE_CHIP: Record<Macro, string> = {
  america: ZONE_RAMPS.america[3],
  emea: ZONE_RAMPS.emea[3],
  asia: ZONE_RAMPS.asia[3]
};

/** El color de una zona según su peso (en %): el tono lo da la zona; la intensidad, el tramo de peso. */
export function zoneColor(macro: Macro, weight: number): string {
  const v = typeof weight === "number" && !Number.isNaN(weight) ? weight : 0;
  const tramo = v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3;
  return ZONE_RAMPS[macro][tramo];
}

/**
 * Las zonas grandes del filtro «Región dominante» del Buscador. El filtro elegía la subzona con más peso, y un fondo de toda Europa
 * salía solo como «Zona Euro»: de los 175 fondos con más de la mitad en Europa, 165 (medido el 06-11-2026 en la base nueva). La zona
 * de un activo es la que más suma de sus subzonas; las subzonas siguen en el filtro, debajo de su zona, para afinar.
 */
export const ZONAS_DEL_BUSCADOR = ["Europa", "Norteamérica", "Iberoamérica", "Asia y Pacífico", "Oriente Medio y África"] as const;
export type ZonaDelBuscador = (typeof ZONAS_DEL_BUSCADOR)[number];

const ZONA_DE_LA_FILA: Record<string, ZonaDelBuscador> = {
  "Estados Unidos": "Norteamérica",
  "Canadá": "Norteamérica",
  "Iberoamérica": "Iberoamérica",
  "Reino Unido": "Europa",
  "Zona Euro": "Europa",
  "Europa - ex Euro": "Europa",
  "Europa emergente": "Europa",
  "Europa, sin desglose": "Europa",
  "Oriente Medio / África": "Oriente Medio y África",
  "Japón": "Asia y Pacífico",
  "Australasia": "Asia y Pacífico",
  "Asia - Desarrollada": "Asia y Pacífico",
  "Asia - Emergente": "Asia y Pacífico",
  "Asia, sin desglose": "Asia y Pacífico"
};

/** La zona grande de una subzona del reparto, o `undefined` si no está en la taxonomía. */
export function zonaDeLaClave(clave: string): ZonaDelBuscador | undefined {
  const normalizada = norm(clave);
  for (const grupo of MORNINGSTAR_REGIONS) {
    for (const fila of grupo.rows) {
      if (fila.keys.includes(normalizada)) return ZONA_DE_LA_FILA[fila.label];
    }
  }
  return undefined;
}

/** La zona grande con más peso de un reparto por subzonas. «Otras» no es una zona (decisión 7). */
export function zonaMayor(reparto: Readonly<Record<string, number>> | null | undefined): ZonaDelBuscador | undefined {
  const { zonas } = zonasDeUnReparto(reparto);
  const suma = new Map<ZonaDelBuscador, number>();
  for (const [clave, peso] of Object.entries(zonas)) {
    const zona = zonaDeLaClave(clave);
    if (zona) suma.set(zona, (suma.get(zona) ?? 0) + peso);
  }
  return [...suma.entries()].sort((a, b) => b[1] - a[1] || ZONAS_DEL_BUSCADOR.indexOf(a[0]) - ZONAS_DEL_BUSCADOR.indexOf(b[0]))[0]?.[0];
}

/**
 * La subzona de una acción por el país de su ISIN: una acción no trae reparto geográfico, y sin esto las 305 del catálogo quedaban
 * en «No la declara». Es el país de la sociedad, no el de la bolsa: una acción alemana que cotiza en EE. UU. sigue siendo de la zona
 * euro. Cubre los países del catálogo medido el 06-11-2026 (ES, US, DE, FR, NL, GB, CH, IE, IT, CA, LU y FI) y los vecinos de la zona.
 */
const SUBZONA_POR_PAIS: Record<string, string> = {
  ES: "eurozone", DE: "eurozone", FR: "eurozone", NL: "eurozone", IT: "eurozone", IE: "eurozone", LU: "eurozone", FI: "eurozone",
  BE: "eurozone", PT: "eurozone", AT: "eurozone", GR: "eurozone",
  GB: "united_kingdom", JE: "united_kingdom", GG: "united_kingdom", IM: "united_kingdom",
  CH: "europe_ex_euro", DK: "europe_ex_euro", SE: "europe_ex_euro", NO: "europe_ex_euro",
  US: "united_states", CA: "canada", JP: "japan", AU: "australasia", NZ: "australasia"
};

export function subzonaDeUnaAccion(isin: string | undefined): string | undefined {
  return isin ? SUBZONA_POR_PAIS[isin.slice(0, 2).toUpperCase()] : undefined;
}
