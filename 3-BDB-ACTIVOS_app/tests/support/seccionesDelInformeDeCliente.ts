/**
 * El texto de cada sección del informe de cliente, leído sobre el PDF. Desde la plantilla única (paso 9 del rediseño) las hojas fluyen y
 * una sección puede empezar a media hoja o seguir en la siguiente: las pruebas ya no buscan «la hoja 3», sino la sección por su título.
 *
 * Recibe el texto de cada hoja (`extractPdfPageTexts`, ya aplanado si se quiere), le quita la cabecera y el pie que la plantilla repite
 * en todas —van primero en el texto de cada hoja, hasta «Página x de N»— y corta el documento entre el título numerado de una sección y
 * el de la siguiente. La presentación es lo que va antes de la primera sección: la portada, que no lleva cifras.
 *
 * Los títulos van **sin número**: el número depende de qué secciones proceden (el cono estadístico no sale sin cifra de la cartera, y
 * entonces las crisis son la 07 y no la 08). Quien quiera el número lo pide con `numeroDe`.
 */

/** El título de cada sección tal como se imprime, sin su número. El histórico ampliado solo sale si se pide. */
export const TITULOS_DEL_INFORME_DE_CLIENTE = {
  composicion: "Composición de la cartera",
  reparto: "Reparto de la cartera",
  /* Las cifras que responden: en su sección, nunca en la portada (Óscar, 15-11-2026). */
  cifras: "Cifras de la cartera",
  geografia: "Distribución geográca",
  evolucion: "Evolución simulada",
  mapa: "Mapa riesgo-rentabilidad",
  /* La frontera eficiente, de vuelta al papel de cliente (Óscar, 16-11-2026). No sale con una sola acción.
     Sin la ligadura «fi», como la geografía: las pruebas aplanan el texto con `plano`, que la quita. */
  frontera: "Frontera eciente",
  /* El cono estadístico, centrado en el tipo sin riesgo (Óscar, 15-11-2026). Solo con cifra de la cartera. */
  cono: "Cuánto podría oscilar su inversión",
  crisis: "Crisis pasadas",
  solapamiento: "Solapamiento entre fondos",
  guia: "Guía de interpretación",
  ampliado: "Histórico ampliado"
} as const;

export type SeccionDelInformeDeCliente = "presentacion" | keyof typeof TITULOS_DEL_INFORME_DE_CLIENTE;

/** El cuerpo de cada hoja, sin la cabecera ni el pie de la plantilla. */
export function cuerpoDeLasHojas(paginas: readonly string[]): string[] {
  return paginas.map((pagina) => pagina.replace(/^[\s\S]*?Página \d+ de \d+\s*/, ""));
}

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** El título numerado de una sección en el texto: dónde empieza y con qué número. Admite la ligadura «fi» perdida o presente. */
function titulo(todo: string, id: keyof typeof TITULOS_DEL_INFORME_DE_CLIENTE): { desde: number; numero: string } | null {
  const patron = escapar(TITULOS_DEL_INFORME_DE_CLIENTE[id])
    .replace("geográca", "geográ(?:fi)?ca")
    .replace("eciente", "e(?:fi)?ciente");
  const hallado = new RegExp(`\\b(\\d\\d) ${patron}`).exec(todo);
  return hallado ? { desde: hallado.index, numero: hallado[1] } : null;
}

const IDS = Object.keys(TITULOS_DEL_INFORME_DE_CLIENTE) as Array<keyof typeof TITULOS_DEL_INFORME_DE_CLIENTE>;
const todoElCuerpo = (paginas: readonly string[]) => cuerpoDeLasHojas(paginas).join(" ").replace(/\s+/g, " ");

/**
 * El texto de una sección, desde su título numerado hasta el de la siguiente. Admite el texto con la ligadura «fi» perdida (la
 * extracción la pierde: «geográca»), que es como lo aplanan las pruebas; con la ligadura, también encuentra el título.
 */
export function seccion(paginas: readonly string[], id: SeccionDelInformeDeCliente): string {
  const todo = todoElCuerpo(paginas);
  const inicios = IDS.map((cada) => titulo(todo, cada)?.desde ?? -1).filter((i) => i >= 0).sort((a, b) => a - b);
  if (id === "presentacion") return todo.slice(0, inicios[0] ?? todo.length);
  const propio = titulo(todo, id);
  if (!propio) return "";
  const hasta = inicios.find((i) => i > propio.desde) ?? todo.length;
  return todo.slice(propio.desde, hasta);
}

/** El número con el que sale una sección («08»), o `null` si no sale. */
export function numeroDe(paginas: readonly string[], id: keyof typeof TITULOS_DEL_INFORME_DE_CLIENTE): string | null {
  return titulo(todoElCuerpo(paginas), id)?.numero ?? null;
}

/** Los números de las secciones que salen, en el orden del documento: «01», «02»… */
export function numerosDeSeccion(paginas: readonly string[]): string[] {
  const todo = todoElCuerpo(paginas);
  return IDS.map((id) => titulo(todo, id)).filter((hallado) => hallado !== null).sort((a, b) => a.desde - b.desde).map((hallado) => hallado.numero);
}

/**
 * Los números que tiene que llevar el documento: seguidos desde «01» y sin saltos. Son nueve secciones de siempre, una más si sale el
 * cono estadístico (solo con cifra de la cartera), otra si sale la frontera eficiente (no con una sola acción) y otra si se pide el
 * histórico ampliado.
 */
export function numerosSeguidos(paginas: readonly string[], { ampliado = false }: { ampliado?: boolean } = {}): string[] {
  const cuantas = 9 + (numeroDe(paginas, "cono") ? 1 : 0) + (numeroDe(paginas, "frontera") ? 1 : 0) + (ampliado ? 1 : 0);
  return Array.from({ length: cuantas }, (_, i) => String(i + 1).padStart(2, "0"));
}
