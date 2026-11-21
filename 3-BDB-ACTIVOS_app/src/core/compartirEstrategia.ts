/**
 * Quién firma Estrategia y qué se lleva el cliente cuando se le comparte. Decisiones 21 y 23 de Óscar
 * (04-11-2026): el informe lo redacta un modelo con búsquedas web, y se dice. El correo lo firma el
 * asesor que lo envía, no una casa (INF-05).
 *
 * El autor se escribe aquí, al pintar, aunque el documento guardado diga «Mesa de Analisis» o «Comite
 * de Inversiones»: lo guardado no se reescribe. De aquí leen la pantalla, el correo y el PDF
 * (`reports/weeklyReportPdf.tsx`), para que los tres digan lo mismo. Los informes que se publiquen a
 * partir de ahora ya traen este autor del servidor.
 */
export const AUTOR_DE_ESTRATEGIA = "Redacción automática (IA)";
export const NOTA_DE_ESTRATEGIA = "Sin revisión humana; cifras de fuentes web";
export const SIN_FUENTES_DE_ESTRATEGIA = "Este informe no registra sus fuentes.";
/*
 * Quien lo envía es el asesor (INF-05, 14-11-2026): el correo firma con su identidad —la de «Tus datos en los informes»
 * (`core/identidadDelAsesor.ts`), la misma que firma los informes—, y sin ella no firma ninguna entidad. Aquí no se
 * escribe el nombre de ninguna casa: antes se escribía uno, en el asunto y en el cierre.
 */

/** Lo que se usa de la identidad del asesor: su nombre y su entidad o despacho, si los ha escrito. */
export interface FirmaDeEstrategia {
  nombre?: string;
  entidad?: string;
}

/** Lo que haya escrito, sin espacios de más; lo vacío no cuenta. */
function limpia(firma: FirmaDeEstrategia | undefined): { nombre?: string; entidad?: string } {
  const nombre = firma?.nombre?.trim();
  const entidad = firma?.entidad?.trim();
  return { ...(nombre ? { nombre } : {}), ...(entidad ? { entidad } : {}) };
}

interface InformeParaCompartir {
  summary: { headline: string; narrative: string };
  sources?: { title: string; url: string }[];
}

export interface MensajeDeEstrategia {
  asunto: string;
  cuerpo: string;
}

/** El mismo tope que la lista de fuentes de la pantalla. */
const FUENTES_QUE_SE_ENUMERAN = 12;

/** «Informe atrasado: tiene 6 días.», o null si el informe está al día. */
export function avisoDeAtraso(atrasado: boolean, diasDeAtraso: number | null): string | null {
  if (!atrasado) return null;
  if (diasDeAtraso === null) return "Informe atrasado.";
  return `Informe atrasado: tiene ${diasDeAtraso} ${diasDeAtraso === 1 ? "día" : "días"}.`;
}

/**
 * Lo que se comparte: fecha, quién lo ha escrito, si va atrasado, titular, texto y fuentes.
 *
 * Las fuentes van por su título y no por su enlace, y no es por estética. Lo que hay guardado son
 * redirecciones de Google de 180 a 520 caracteres (medido el 04-11-2026 en los informes de la base
 * local): con doce, un `mailto:` pasa de los 2.000 caracteres, y hay clientes de correo que entonces
 * no se abren. El título es el dominio, «morningstar.com», y dice lo que tiene que decir.
 */
export function mensajeDeEstrategia({
  titulo,
  fecha,
  informe,
  atrasado,
  diasDeAtraso,
  firma
}: {
  titulo: string;
  fecha: string;
  informe: InformeParaCompartir;
  atrasado: boolean;
  diasDeAtraso: number | null;
  /** La identidad del asesor que lo envía. Sin ella, el correo no lleva firma. */
  firma?: FirmaDeEstrategia;
}): MensajeDeEstrategia {
  const { nombre, entidad } = limpia(firma);
  const atraso = avisoDeAtraso(atrasado, diasDeAtraso);
  /* El mismo dominio sale tantas veces como páginas se consultaron de él: una vez basta. */
  const fuentes = [...new Set((informe.sources ?? []).map((fuente) => fuente.title).filter(Boolean))];
  const lineaDeFuentes = fuentes.length
    ? `Fuentes consultadas: ${fuentes.slice(0, FUENTES_QUE_SE_ENUMERAN).join(", ")}${fuentes.length > FUENTES_QUE_SE_ENUMERAN ? " y otras" : ""}.`
    : SIN_FUENTES_DE_ESTRATEGIA;

  const cuerpo = [
    [`${titulo} · ${fecha}`, `${AUTOR_DE_ESTRATEGIA}. ${NOTA_DE_ESTRATEGIA}.`, atraso].filter(Boolean).join("\n"),
    informe.summary.headline,
    informe.summary.narrative,
    lineaDeFuentes,
    /* La firma, como la de un correo: el nombre y debajo la entidad. Sin ninguno de los dos, no hay bloque de firma. */
    [nombre, entidad].filter(Boolean).join("\n") || null
  ]
    .filter((bloque): bloque is string => Boolean(bloque))
    .join("\n\n");

  /* En el asunto, de quién viene: la entidad si la hay, y si no el nombre. Sin ninguno, solo el título. */
  const remite = entidad ?? nombre;
  return { asunto: remite ? `${titulo} · ${remite}` : titulo, cuerpo };
}
