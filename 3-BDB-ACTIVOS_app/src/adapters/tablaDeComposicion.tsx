import { bloqueadoPorCalidadDelDato, rotuloDeLoQueNoEntra } from "../core/assetMapping";
import { esAccion } from "../core/esAccion";
import { CATEGORIA_DE_UNA_ACCION, categoriaLegible } from "../core/etiquetasDeReparto";
import * as formato from "../core/formato";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import { ETIQUETAS_DE_CALIDAD } from "../core/glosarioDePantalla";
import type { FueraDeLaMedida } from "../core/medidaDeLaCartera";
import { rotuloDeLaVentana } from "../core/metricsFrequency";
import type { ResolvedPositionBounds } from "../core/portfolioConstraints";
import { PORTFOLIO_HEALTH_RULES } from "../core/portfolioHealth";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioReport } from "../types/bdbAssets";
import type { PortfolioRiskContribution } from "../types/portfolioFrontier";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { CeldaDeTabla, ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import { ClaseConColor } from "../components/ui/ClaseConColor";
import { Distintivo } from "../components/ui/Distintivo";

/**
 * «Composición de la cartera» de Análisis: una sola tabla con lo que había en dos.
 *
 * Hasta el 04-11-2026 Análisis tenía una tabla por estrategia (fondo, peso, volatilidad) y el Informe otra
 * con las mismas filas (vehículo, clase, divisa, importe, límites, calidad). La decisión 25 saca del
 * Informe lo que se pintaba y lo deja en Análisis, y dos tablas con las mismas ocho filas no aportan nada.
 *
 * Tres cosas que importan:
 *
 * - **Un grupo de un solo fondo es una fila.** Con ocho fondos en ocho estrategias salían dieciséis líneas
 *   y cada peso dos veces. El orden es por peso, no alfabético.
 * - **Lo que manda en el riesgo es lo que aporta, no lo que oscila solo.** La columna terracota señalaba
 *   al fondo más volátil, aunque quien pesa en el riesgo de la cartera sea otro. La aportación es de la
 *   parte medida, y por eso sale de la misma simulación que la tira de cifras.
 * - **Sin capital fijado, la columna de importe no sale.** Ocho rayas no dicen nada, y una raya se puede
 *   leer como cero.
 */

export interface EntradaDeComposicion {
  positions: readonly BdbManualPortfolioPosition[];
  assets: readonly BdbAssetDetail[];
  /** Las posiciones del informe: traen el resumen de calidad, el tipo y la divisa. */
  posicionesDelInforme?: BdbPortfolioReport["positions"];
  aportaciones?: readonly PortfolioRiskContribution[] | null;
  fuera?: readonly FueraDeLaMedida[];
  limites?: readonly ResolvedPositionBounds[];
  capital?: number;
  /**
   * Los años del periodo elegido (ANA-14). La volatilidad de cada activo es la de esa ventana: con «5 años», la de 5 años, que
   * el dato trae como `volatility_5y`. Dos cifras se leen juntas solo si son de la misma ventana, y «Aporta al riesgo» sale de
   * la simulación del periodo. Sin él, 3 años, como antes.
   */
  anos?: 3 | 5;
}

export interface FilaDeComposicion extends FilaAgrupable {
  nombre: string;
  apunte?: string;
  pesoPct: number;
  importe: number | null;
  aportaPct?: number;
  /** Se ha quedado fuera de la serie: no tiene aportación que enseñar. */
  fueraDeLaSerie: boolean;
  motivoDeFuera?: string;
  volatilidad?: number;
  /** La cifra de «Volatilidad sola» es la que copia el proveedor, no una nuestra: se dice en la celda. */
  volatilidadDelProveedor?: boolean;
  producto?: string;
  clase?: string;
  /** La clave de la clase de activo (`EQUITY`…): de ella sale el color del punto que acompaña al nombre. */
  claveDeClase?: string;
  divisa?: string;
  noInvertible: boolean;
  /** Deoleo y las otras dos: no entran, y no por no ser invertibles (decisión 75). */
  bloqueadoPorCalidad?: boolean;
  /** La CAM: nunca se resolvió y no tiene serie de precios. Eso es lo que la deja fuera, y no se dice «No invertible» (decisión 44). */
  sinSerie?: boolean;
  limite?: string;
  calidad?: string;
}

const capitalFijado = (capital: number | undefined): capital is number =>
  typeof capital === "number" && Number.isFinite(capital) && capital > 0;

/** «Completa · 1 aviso», sin el «Cobertura Cobertura completa» que salía antes. */
export function textoDeCalidad(resumen: BdbPortfolioReport["positions"][number]["data_quality_summary"]): string | undefined {
  if (!resumen) return undefined;
  if (typeof resumen === "string") {
    /* El resumen puede arrastrar códigos (MISSING_HOLDINGS…): a pantalla llegan traducidos. */
    return resumen.replace(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g, (codigo) => ETIQUETAS_DE_CALIDAD[codigo] ?? readableBackendLabel(codigo));
  }
  const estado = readableBackendLabel(String(resumen.coverage_status)).replace(/^cobertura\s+/i, "");
  const avisos = resumen.warnings_count;
  return `${estado.charAt(0).toLocaleUpperCase("es")}${estado.slice(1)} · ${avisos} ${avisos === 1 ? "aviso" : "avisos"}`;
}

/* Un límite es un peso: con un decimal y sin la unidad, que va una vez al final del tramo. */
const pesoDeLimite = (fraccion: number) => formato.oFalta(formato.numero(fraccion * 100, { decimales: 1 }));

/** El de `formato`: la cifra y su «%» no se separan al saltar de línea. */
const ESPACIO_DURO = String.fromCharCode(0xa0);

/**
 * El límite propio de una posición, en una línea, o nada si no lo tiene. Los 0–100 % de todas las filas
 * no son un límite: son la ausencia de uno.
 */
export function limiteDe(limite: ResolvedPositionBounds | undefined): string | undefined {
  if (!limite) return undefined;
  if (typeof limite.locked_weight === "number") return `Fijado · ${pesoDeLimite(limite.locked_weight)}${ESPACIO_DURO}%`;
  if (limite.min_weight <= 0 && limite.max_weight >= 1) return undefined;
  if (Math.abs(limite.min_weight - limite.max_weight) < 0.000001) return `${pesoDeLimite(limite.min_weight)}${ESPACIO_DURO}% fijo`;
  return `${pesoDeLimite(limite.min_weight)}–${pesoDeLimite(limite.max_weight)}${ESPACIO_DURO}%`;
}

/** La suma de los pesos con valor, que es entre lo que se reparte el capital: la misma que usa el cuadro de costes. */
export function pesoRepartido(positions: readonly BdbManualPortfolioPosition[]): number {
  return positions.reduce((suma, posicion) => suma + (Number.isFinite(posicion.weight_percent) && posicion.weight_percent > 0 ? posicion.weight_percent : 0), 0);
}

/** Las filas, por peso, con la cabecera de grupo solo donde hay más de un fondo. */
export function filasDeComposicion(entrada: EntradaDeComposicion): FilaDeComposicion[] {
  const { positions, assets, posicionesDelInforme = [], aportaciones, fuera = [], limites = [], capital, anos = 3 } = entrada;
  const ventana = anos === 5 ? "5y" : "3y";
  const activoDe = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const delInforme = new Map(posicionesDelInforme.map((posicion) => [posicion.asset_id, posicion]));
  const aportacionDe = new Map((aportaciones ?? []).map((item) => [item.asset_id, item.risk_pct]));
  const fueraDe = new Map(fuera.map((item) => [item.assetId, item]));
  const limiteDel = new Map(limites.map((item) => [item.asset_id, item]));

  const grupos = new Map<string, BdbManualPortfolioPosition[]>();
  positions.forEach((posicion) => {
    const asset = activoDe.get(posicion.asset_id);
    /* Por el nombre que se enseña: la misma categoría en dos idiomas es un solo grupo (decisión 101). Una acción sin categoría, que es como las trae
       la base nueva, es «Acciones», como en la base vieja y en el papel (decisión 83), y no se mezcla con un fondo de bolsa sin categoría. */
    const clave =
      categoriaLegible(asset?.category) ??
      (asset && esAccion(asset.instrument_type) ? CATEGORIA_DE_UNA_ACCION : undefined) ??
      (asset ? (CLASS_LABELS[asset.economic_asset_class] ?? readableBackendLabel(asset.economic_asset_class)) : "Sin clasificar");
    grupos.set(clave, [...(grupos.get(clave) ?? []), posicion]);
  });

  const pesoDe = (posicion: BdbManualPortfolioPosition) => posicion.weight_percent || 0;
  /* ANA-13: el capital se reparte como en el cuadro de costes (`calculatePortfolioCosts`), en proporción a los pesos con valor: si
     suman 98 %, cada 24,5 % es una cuarta parte del capital. Así una posición vale lo mismo en Análisis y en Costes, y la tabla lo dice. */
  const repartido = pesoRepartido(positions);
  const importeDe = (peso: number) => (capitalFijado(capital) && repartido > 0 ? (Math.max(peso, 0) / repartido) * capital : null);

  const filaDe = (posicion: BdbManualPortfolioPosition, grupo: string | undefined, estrategia: string | undefined): FilaDeComposicion => {
    const asset = activoDe.get(posicion.asset_id);
    const informe = delInforme.get(posicion.asset_id);
    const fueraDeLaSerie = fueraDe.get(posicion.asset_id);
    const clase = informe?.economic_asset_class ?? asset?.economic_asset_class;
    const tipo = informe?.instrument_type ?? asset?.instrument_type;
    return {
      id: posicion.asset_id,
      grupoDeFilas: grupo,
      nombre: asset?.display_name ?? informe?.display_name ?? posicion.label ?? posicion.asset_id,
      apunte: [posicion.asset_id, estrategia].filter(Boolean).join(" · "),
      pesoPct: pesoDe(posicion),
      importe: importeDe(pesoDe(posicion)),
      aportaPct: aportacionDe.get(posicion.asset_id),
      fueraDeLaSerie: Boolean(fueraDeLaSerie),
      motivoDeFuera: fueraDeLaSerie?.motivo,
      /* La del periodo elegido, y si el activo no la tiene para ese periodo, falta: nunca la de otra ventana en su lugar. */
      volatilidad: anos === 5 ? asset?.metrics?.volatility_5y : asset?.metrics?.volatility_3y,
      volatilidadDelProveedor: rotuloDeLaVentana(asset?.metrics, ventana).method === "TRAILING_PROVIDER",
      producto: tipo ? (TYPE_LABELS[tipo] ?? readableBackendLabel(tipo)) : undefined,
      clase: clase ? (CLASS_LABELS[clase] ?? readableBackendLabel(clase)) : undefined,
      claveDeClase: clase ?? undefined,
      divisa: informe?.currency ?? asset?.currency,
      noInvertible: informe ? !informe.is_investable : false,
      bloqueadoPorCalidad: informe ? bloqueadoPorCalidadDelDato(informe) : false,
      sinSerie: (informe?.quality_flags ?? []).includes("NON_INVESTABLE_NEVER_RESOLVED"),
      limite: limiteDe(limiteDel.get(posicion.asset_id)),
      calidad: textoDeCalidad(informe?.data_quality_summary)
    };
  };

  return [...grupos.entries()]
    .map(([clave, miembros]) => ({
      clave,
      miembros: [...miembros].sort((a, b) => pesoDe(b) - pesoDe(a)),
      total: miembros.reduce((suma, posicion) => suma + pesoDe(posicion), 0)
    }))
    .sort((a, b) => b.total - a.total)
    .flatMap(({ clave, miembros, total }) => {
      /* La clave ya es lo que se lee: `readableBackendLabel` escribiría «Rf dkk» donde dice «RF DKK». */
      if (miembros.length === 1) return [filaDe(miembros[0], undefined, clave)];
      return [
        {
          id: `grupo-${clave}`,
          grupoDeFilas: clave,
          cabeceraDeGrupo: true,
          nombre: clave,
          pesoPct: total,
          importe: importeDe(total),
          fueraDeLaSerie: false,
          noInvertible: false
        },
        ...miembros.map((posicion) => filaDe(posicion, clave, undefined))
      ];
    });
}

const VACIA: CeldaDeTabla = { texto: "" };
const FALTA = textoDeAusencia("falta");
const texto = (valor: string | undefined): CeldaDeTabla => (valor ? { texto: valor, valor } : { texto: FALTA, ausencia: "falta" });
/** Un peso de 0 a 100, con un decimal: «24,0 %». */
const pesoEscrito = (pct: number) => formato.peso(pct / 100) ?? FALTA;

function celdaDeAportacion(fila: FilaDeComposicion, midiendo: boolean, unSoloMedido: boolean): CeldaDeTabla {
  if (fila.cabeceraDeGrupo) return VACIA;
  if (fila.fueraDeLaSerie) return { texto: "Fuera de la simulación", ausencia: "falta" };
  if (typeof fila.aportaPct !== "number") {
    if (midiendo) return { texto: "Midiendo…", ausencia: "no-aplica" };
    /* Lo mismo que dice la fila de Salud: con un solo activo medido no hay reparto, y eso no es que falte. */
    return unSoloMedido ? { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" } : { texto: FALTA, ausencia: "falta" };
  }
  const escrita = pesoEscrito(fila.aportaPct);
  /* Lo que supera el umbral de aportación pide la atención del asesor: el ocre, y con su palabra. La cifra, en tinta. */
  return fila.aportaPct > PORTFOLIO_HEALTH_RULES.RISK_CONTRIBUTION_WARN_PCT
    ? {
        texto: escrita,
        valor: fila.aportaPct,
        nodo: (
          <>
            <span className="cifra">{escrita}</span> <Distintivo tono="aviso">Revisar</Distintivo>
          </>
        )
      }
    : { texto: escrita, valor: fila.aportaPct };
}

export interface OpcionesDeComposicion {
  /** Límites y calidad del dato son del asesor: en Modo cliente no salen. */
  clientMode: boolean;
  /** Hay capital fijado: si no, la columna de importe no sale. */
  conImporte: boolean;
  /** Alguna posición tiene un límite propio: si no, la columna no sale. */
  conLimites: boolean;
  /** La medición aún no ha llegado: la aportación no falta, viene de camino. */
  midiendo: boolean;
  /** La simulación solo ha medido un activo: no hay reparto del riesgo que enseñar. */
  unSoloMedido?: boolean;
  /** Los años del periodo elegido: el rótulo de la volatilidad lo dice con palabras (ANA-14). 3 por defecto. */
  anos?: 3 | 5;
}

/**
 * La «Volatilidad sola» de una cifra del proveedor va al lado de las nuestras y no es igual: otro estimador y, si
 * la clase no es en euros, otra divisa. En Modo cliente, quién la da es cocina; la divisa no: cambia lo que se lee.
 */
function apunteDeLaVolatilidad(fila: FilaDeComposicion, clientMode: boolean): string | undefined {
  if (!fila.volatilidadDelProveedor) return undefined;
  const enOtra = fila.divisa && fila.divisa !== "EUR" ? fila.divisa : null;
  if (clientMode) return enOtra ? `En ${enOtra}, sin convertir` : undefined;
  return enOtra ? `Del proveedor, en ${enOtra}` : "Del proveedor";
}

export function columnasDeComposicion({ clientMode, conImporte, conLimites, midiendo, unSoloMedido = false, anos = 3 }: OpcionesDeComposicion): ColumnaDeTabla<FilaDeComposicion>[] {
  return [
    {
      id: "activo",
      titulo: "Activo",
      encabezaFila: true,
      nombre: true,
      celda: (fila) => ({
        texto: fila.nombre,
        valor: fila.nombre,
        apunte: fila.apunte,
        enlaceAFicha: fila.cabeceraDeGrupo ? undefined : fila.id
      })
    },
    { id: "peso", titulo: "Peso", cifra: true, celda: (fila) => ({ texto: pesoEscrito(fila.pesoPct), valor: fila.pesoPct }) },
    ...(conImporte
      ? [{
          id: "importe",
          titulo: "Importe",
          cifra: true,
          celda: (fila: FilaDeComposicion): CeldaDeTabla => {
            const escrito = formato.importe(fila.importe);
            return escrito ? { texto: escrito, valor: fila.importe ?? undefined } : { texto: FALTA, ausencia: "falta" };
          }
        }]
      : []),
    { id: "aporta", titulo: "Aporta al riesgo", cifra: true, celda: (fila) => celdaDeAportacion(fila, midiendo, unSoloMedido) },
    {
      id: "volatilidad",
      /* La del activo por su cuenta, en la ventana del periodo elegido. La cabecera, corta («Vol. 3A», Óscar, 17-11-2026); el
         nombre entero, con palabras («Volatilidad 3 años»), al pasar el ratón. */
      titulo: Number.isInteger(anos) ? `Vol. ${anos}A` : `Vol. ${aniosEnPalabras(anos)}`,
      tituloCompleto: `Volatilidad ${aniosEnPalabras(anos)}`,
      cifra: true,
      celda: (fila) =>
        fila.cabeceraDeGrupo
          ? VACIA
          : typeof fila.volatilidad === "number" && Number.isFinite(fila.volatilidad)
            ? { texto: formato.porcentaje(fila.volatilidad) ?? FALTA, valor: fila.volatilidad, apunte: apunteDeLaVolatilidad(fila, clientMode) }
            : { texto: FALTA, ausencia: "falta" }
    },
    { id: "producto", titulo: "Producto", celda: (fila) => (fila.cabeceraDeGrupo ? VACIA : texto(fila.producto)) },
    {
      id: "clase",
      titulo: "Clase",
      tituloCompleto: "Clase de activo",
      celda: (fila) => {
        if (fila.cabeceraDeGrupo) return VACIA;
        const celda = texto(fila.clase);
        const conApunte = fila.noInvertible
          ? { ...celda, apunte: fila.sinSerie ? "Sin serie de precios" : rotuloDeLoQueNoEntra({ quality_flags: fila.bloqueadoPorCalidad ? ["QUALITY_BLOCKED"] : [] }, clientMode) }
          : celda;
        /* El nombre de la clase con el punto de su color, el mismo que en «En qué está invertida» (14-11-2026). El texto se queda
           para ordenar y para quien lea la celda sin pintarla; lo que falta sigue diciéndolo la ausencia, sin punto. */
        if (!fila.clase) return conApunte;
        return {
          ...conApunte,
          nodo: (
            <>
              <ClaseConColor clave={fila.claveDeClase}>{fila.clase}</ClaseConColor>
              {conApunte.apunte ? <span className="tabla__apunte">{conApunte.apunte}</span> : null}
            </>
          )
        };
      }
    },
    { id: "divisa", titulo: "Divisa", celda: (fila) => (fila.cabeceraDeGrupo ? VACIA : texto(fila.divisa)) },
    ...(!clientMode && conLimites
      ? [{
          id: "limites",
          titulo: "Límites",
          cifra: true,
          celda: (fila: FilaDeComposicion) => ({ texto: fila.limite ?? "" })
        }]
      : []),
    ...(!clientMode
      ? [{
          id: "calidad",
          titulo: "Calidad",
          tituloCompleto: "Calidad del dato",
          celda: (fila: FilaDeComposicion): CeldaDeTabla =>
            fila.cabeceraDeGrupo
              ? VACIA
              : fila.fueraDeLaSerie
                ? { texto: `Fuera del cálculo: ${fila.motivoDeFuera ?? "sin motivo"}`, ausencia: "falta" }
                : texto(fila.calidad)
        }]
      : [])
  ];
}
