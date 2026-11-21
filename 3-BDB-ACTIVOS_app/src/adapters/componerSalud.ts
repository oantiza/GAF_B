import type { Documento } from "./baseNuevaLectura";

/**
 * La salud del catálogo entero, leída de las 1.077 calidades.
 *
 * Esta pantalla contesta una pregunta que ninguna otra contesta: **dónde conviene
 * invertir esfuerzo de datos**. No es lo mismo un campo que falta en tres instrumentos
 * que uno que falta en los 1.077: el segundo no es un hueco de cobertura, es una
 * decisión que nadie ha tomado —o un cálculo que no se produce— y se arregla una vez.
 */

export interface SaludDelCatalogo {
  instrumentos: number;
  presentes: number;
  aplicables: number;
  /** Cobertura agregada en tanto por uno. */
  cobertura: number;
  /** Ausencias por clase, sobre todo el catálogo. */
  porClase: { falta: number; noAplica: number; sinPedir: number };
  /** Las rutas que más faltan, con en cuántos instrumentos. */
  rutas: Array<{ ruta: string; cuantos: number; enTodos: boolean }>;
  /** Los avisos que la base emite, y a cuántos instrumentos. */
  avisos: Array<{ codigo: string; cuantos: number; mensaje: string }>;
  /** Para qué sirve el catálogo, uso por uso. */
  aptitudes: Array<{ clave: string; si: number; no: number }>;
}

interface Ausencia {
  path: string;
  reason: string;
}

interface Aviso {
  code?: string;
  message?: string;
}

/** Cómo se llama cada aviso de la base. Lo que venga sin nombre se escribe a partir de su código. */
const NOMBRE_DEL_AVISO: Record<string, string> = {
  SIN_INDICADOR_REGULATORIO: "Sin indicador regulatorio",
  METRICAS_DE_MUESTREO_DIARIO: "Métricas de muestreo diario",
  SIN_SHARPE_POR_DIVISA: "Sin Sharpe por divisa",
  SIN_REPARTO_DE_ACTIVOS: "Sin reparto de activos",
  POLITICA_DE_DISTRIBUCION_DESCONOCIDA: "Política de distribución desconocida",
  SIN_COSTE_CORRIENTE: "Sin coste corriente",
  INDICE_SIN_DIVISA_NI_VARIANTE: "Índice sin divisa ni variante",
  AUSENCIAS_RECORTADAS: "Ausencias recortadas"
};

/**
 * Qué dato es cada campo, en palabras: una ruta como `declared/size.aum` no le dice nada a quien no ha leído el
 * contrato. Los nombres son los de la ficha (`componerFicha.ts`), para que el mismo dato se llame igual en las dos
 * pantallas.
 */
const NOMBRE_DE_LA_RUTA: Record<string, string> = {
  "declared/costs.entry_charge": "Comisión de entrada (suscripción)",
  "declared/costs.exit_charge": "Comisión de salida (reembolso)",
  "declared/costs.management_fee": "Comisión de gestión",
  "declared/costs.ongoing_charge": "Coste corriente",
  "declared/costs.performance_fee": "Comisión de éxito",
  "declared/costs.transaction_costs": "Costes de operación",
  /* El nombre de la ficha (`ROTULO_DEL_REPARTO_12M`): el sistema no dice «rendimiento» (FMT-13). */
  "declared/distributions.yield_12m": "Rentabilidad por reparto, 12 meses",
  "declared/dividends.currency": "Divisa del dividendo",
  "declared/dividends.ex_dividend_date": "Fecha ex-dividendo",
  "declared/dividends.trailing_amount_per_share": "Dividendo pagado en 12 meses",
  "declared/dividends.yield_12m": "Rentabilidad por dividendo prevista",
  "declared/equity.business_description": "Actividad de la empresa",
  "declared/equity.industry": "Industria",
  "declared/equity.listing.country": "País del listado",
  "declared/equity.listing.exchange": "Bolsa",
  "declared/equity.sector": "Sector",
  "declared/exposure.asset_mix": "Reparto por clase de activo",
  "declared/exposure.equity_style_box": "Estilo de la renta variable",
  "declared/exposure.confidence": "Fiabilidad del reparto",
  "declared/fixed_income": "Datos de renta fija",
  "declared/profile": "Perfil del fondo",
  "declared/profile.distribution_policy": "Política de distribución",
  "declared/profile.hedged_class": "Clase cubierta",
  "declared/profile.sfdr_article": "Artículo SFDR",
  "declared/provider_returns.ytd_return.fund": "Rentabilidad en lo que va de año",
  "declared/provider_risk": "Riesgo según el proveedor",
  "declared/provider_risk.beta.1y.vs_benchmark": "Beta a 1 año",
  "declared/provider_risk.beta.3y.vs_benchmark": "Beta a 3 años",
  "declared/provider_risk.r2.1y.vs_benchmark": "R² a 1 año",
  "declared/size.aum": "Patrimonio",
  "declared/sustainability.esg_globes": "Sostenibilidad",
  "declared/regulatory.srri": "SRRI, de UCITS",
  "declared/regulatory.sri": "SRI, del KID de PRIIPs",
  "declared/regulatory.recommended_holding_years": "Plazo de inversión recomendado",
  "declared/issuer_data": "Datos del emisor",
  "classification.category": "Categoría",
  "classification.morningstar_rating": "Calificación de Morningstar",
  "classification.official_benchmark": "Índice de referencia oficial",
  "classification.official_benchmark.currency": "Divisa del índice de referencia",
  "classification.official_benchmark.variant": "Variante del índice de referencia",
  "classification.official_benchmark.instrument_id": "El índice de referencia, en nuestra base",
  "computed/premium_discount": "Prima o descuento sobre el valor liquidativo",
  issuer_nav: "Valor liquidativo del emisor",
  product: "Datos del producto"
};

/** De qué bloque es un campo, cuando el campo concreto no tiene nombre todavía. */
const NOMBRE_DEL_BLOQUE: ReadonlyArray<[string, string]> = [
  ["declared/costs", "Un coste declarado"],
  ["declared/dividends", "Un dato de dividendos"],
  ["declared/distributions", "Un dato de reparto"],
  ["declared/equity", "Un dato de la empresa"],
  ["declared/exposure", "Un dato de la composición"],
  ["declared/fixed_income", "Un dato de renta fija"],
  ["declared/profile", "Un dato del perfil del fondo"],
  ["declared/provider_returns", "Una rentabilidad del proveedor"],
  ["declared/provider_risk", "Una cifra de riesgo del proveedor"],
  ["declared/regulatory", "Un dato regulatorio"],
  ["declared/sustainability", "Un dato de sostenibilidad"],
  ["declared/size", "Un dato de tamaño"],
  ["declared/issuer_data", "Un dato del emisor"],
  ["computed/metrics", "Una métrica nuestra"],
  ["computed", "Un dato calculado"],
  ["classification", "Un dato de clasificación"],
  ["declared", "Un dato declarado por el proveedor"]
];

/** Qué dato es una ruta, en palabras. Lo que no se conoce dice de qué bloque es, o que aún no tiene nombre. */
export function rutaEnPalabras(ruta: string): string {
  const conocido = NOMBRE_DE_LA_RUTA[ruta];
  if (conocido) return conocido;
  const bloque = NOMBRE_DEL_BLOQUE.find(([prefijo]) => ruta === prefijo || ruta.startsWith(`${prefijo}/`) || ruta.startsWith(`${prefijo}.`));
  return bloque ? bloque[1] : "Campo aún sin nombre en palabras";
}

export function nombreDelAviso(codigo: string): string {
  const conocido = NOMBRE_DEL_AVISO[codigo];
  if (conocido) return conocido;
  const texto = codigo.replace(/_/g, " ").toLowerCase();
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

export function componerSalud(calidades: Documento[]): SaludDelCatalogo {
  const porClase = { falta: 0, noAplica: 0, sinPedir: 0 };
  const porRuta = new Map<string, number>();
  const porAviso = new Map<string, { cuantos: number; mensaje: string }>();
  const porAptitud = new Map<string, { si: number; no: number }>();
  let presentes = 0;
  let aplicables = 0;

  for (const calidad of calidades) {
    presentes += Number(calidad["present_paths"] ?? 0);
    aplicables += Number(calidad["applicable_paths"] ?? 0);

    for (const ausencia of (calidad["absences"] as Ausencia[] | undefined) ?? []) {
      if (ausencia.reason === "NOT_PROVIDED") porClase.falta += 1;
      else if (ausencia.reason === "NOT_APPLICABLE") porClase.noAplica += 1;
      else if (ausencia.reason === "NOT_YET_FETCHED") porClase.sinPedir += 1;
      porRuta.set(ausencia.path, (porRuta.get(ausencia.path) ?? 0) + 1);
    }

    for (const aviso of (calidad["warnings"] as Aviso[] | undefined) ?? []) {
      const codigo = aviso.code ?? "";
      const previo = porAviso.get(codigo);
      porAviso.set(codigo, {
        cuantos: (previo?.cuantos ?? 0) + 1,
        mensaje: previo?.mensaje ?? aviso.message ?? ""
      });
    }

    const fitness = (calidad["fitness"] ?? {}) as Record<string, { apt?: boolean }>;
    for (const [clave, valor] of Object.entries(fitness)) {
      const previo = porAptitud.get(clave) ?? { si: 0, no: 0 };
      if (valor.apt) previo.si += 1;
      else previo.no += 1;
      porAptitud.set(clave, previo);
    }
  }

  const instrumentos = calidades.length;
  return {
    instrumentos,
    presentes,
    aplicables,
    cobertura: aplicables > 0 ? presentes / aplicables : 0,
    porClase,
    rutas: [...porRuta.entries()]
      .map(([ruta, cuantos]) => ({ ruta, cuantos, enTodos: cuantos === instrumentos }))
      .sort((a, b) => b.cuantos - a.cuantos),
    avisos: [...porAviso.entries()]
      .map(([codigo, dato]) => ({ codigo, ...dato }))
      .sort((a, b) => b.cuantos - a.cuantos),
    aptitudes: [...porAptitud.entries()]
      .map(([clave, dato]) => ({ clave, ...dato }))
      .sort((a, b) => a.si - b.si)
  };
}
