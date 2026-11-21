/**
 * La plantilla única de los informes en PDF: un solo diseño con dos temas (cliente, granate y bronce; interno, acero), con el
 * aspecto del papel de cliente de antes (decisión de Óscar del 14-11-2026): Fraunces en títulos y cifras grandes, Roboto Flex
 * en lo demás, tinta cálida, filetes finos y ningún relleno de color sólido.
 *
 * Cómo se monta un documento:
 *  1. Cada parte es una sección (`SeccionDeInforme`): `id`, `titulo`, cuándo `procede` y su `Contenido`, escrito con
 *     las piezas de aquí (`CifrasDestacadas`, `Tabla`, `GraficoDeLineas`, `Nota`…). La primera es la portada
 *     (`comienzo: "portada"`, con `Portada`) en el informe de cliente y en el de cartera del gestor, y la presentación
 *     (`comienzo: "presentacion"`, con `Presentacion` y las cifras que responden) en los demás.
 *  2. Las cifras llegan ya escritas por `src/core/formato.ts`; lo que falta llega como `null` y la pieza escribe su
 *     frase de ausencia. Todo texto se sanea solo (`sanearTexto`): no hace falta acordarse.
 *  3. `<DocumentoDeInforme tema identidad documento destinatario>` con `<HojasDeSecciones secciones datos />` dentro;
 *     o, sin secciones, `<Hoja>` a mano. La cabecera, el sello y «Página x de N» los pone la hoja.
 *  4. `renderizarInforme(elemento)` devuelve el `Blob`. Este módulo trae @react-pdf: impórtalo de forma dinámica.
 */
export { ADVERTENCIA_DEL_PIE, AVISO_LEGAL } from "./avisoLegal";
export { useHoja, useInforme, type IdentidadDelAsesor } from "./contexto";
export { DocumentoDeInforme, renderizarInforme, type PropiedadesDelDocumento } from "./documento";
export { cortesDelEje, marcasDeFechas, tramos } from "./escalas";
export { FUENTE, refrescarFuentes } from "./fuentes";
export { GraficoDeLineas, ListaDePartes, TRAZO_LARGO, type ParteDelTodo, type PropiedadesDelGraficoDeLineas, type SerieDeLineas } from "./graficos";
export { Hoja } from "./hoja";
export { Aviso, AvisoLegal, CifrasDestacadas, Nota, Parrafo, Presentacion, Rejilla, TituloDeSeccion, type CifraDestacada, type DatoDeRejilla } from "./piezas";
export { Portada, type PropiedadesDeLaPortada } from "./portada";
export { Texto } from "./primitivas";
export { HojasDeSecciones, repartirEnHojas, seccionesQueProceden, type ComienzoDeSeccion, type SeccionDeInforme } from "./secciones";
export { Tabla, type CeldaDeTabla, type ColumnaDeTabla, type FilaDeTabla } from "./tabla";
export {
  BLANCO_DESDE_EL_PASO,
  COLOR_DE_CLASE,
  COLORES_DE_DATOS,
  MEDIDAS,
  PAPEL,
  RAMPA_DEL_TEMA,
  SERIES,
  SERIES_DEL_TEMA,
  SIN_CLASIFICAR,
  TEMAS,
  anchoUtil,
  colorDeCategoria,
  colorDeSerie,
  colorDelSigno,
  type TemaDeInforme
} from "./tema";
export { SIN_TRANSCRIPCION, sanearTexto } from "./texto";
