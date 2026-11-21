/**
 * La pregunta antes de salir de una cartera abierta del gestor con cambios que se perderían (GES-01).
 *
 * Es la misma salga el asesor por «← Todas las carteras» o desde fuera del gestor (el menú, el
 * recuadro de la cartera activa, una ficha, «Salir», el envío a Diseño). Primero se escribe lo
 * pendiente; solo si aun así se perdería algo, se pregunta. La pregunta la pinta la cartera abierta,
 * que es quien sabe si hay carpeta; el marco solo pide permiso para salir.
 */
import type { ConfirmOptions } from "../../components/ui/ConfirmDialog";
import type { SalidaDelGestor } from "./estado/useCarteraAbierta";

/**
 * Escribe lo pendiente y, si aun así se perderían cambios, pregunta. Devuelve si se puede salir: con
 * «Descargar una copia y salir» o «Salir sin guardar», sí; con «Seguir en la cartera», no, y todo
 * queda como estaba.
 */
export async function preguntarAntesDeSalir(
  salida: Pick<SalidaDelGestor, "prepararSalida" | "descargarCopia" | "descartarCambios">,
  confirm: (opciones: ConfirmOptions) => Promise<boolean>,
  conCarpeta: boolean
): Promise<boolean> {
  if (!(await salida.prepararSalida())) return true;
  const descargar = await confirm({
    title: "Hay cambios que se perderían",
    message: conCarpeta
      ? "Los últimos cambios de esta cartera no se han podido guardar en la carpeta de carteras. Si sales ahora, se pierden. Descarga una copia del fichero para conservarlos."
      : "Los cambios de esta cartera solo están en esta pantalla: este navegador no guarda en una carpeta. Si sales sin descargar el fichero, se pierden.",
    confirmLabel: "Descargar una copia y salir",
    cancelLabel: "No descargar"
  });
  if (descargar) {
    salida.descargarCopia();
    salida.descartarCambios();
    return true;
  }
  const salir = await confirm({
    title: "¿Salir sin guardar los cambios?",
    message: "Lo que no se ha guardado ni descargado se pierde y no se puede recuperar.",
    confirmLabel: "Salir sin guardar",
    cancelLabel: "Seguir en la cartera",
    tone: "danger"
  });
  if (!salir) return false;
  salida.descartarCambios();
  return true;
}

let preguntaActual: (() => Promise<boolean>) | null = null;

/** La cartera abierta deja aquí su pregunta mientras está en pantalla. Devuelve con qué quitarla. */
export function registrarPreguntaDeSalida(pregunta: () => Promise<boolean>): () => void {
  preguntaActual = pregunta;
  return () => {
    if (preguntaActual === pregunta) preguntaActual = null;
  };
}

/**
 * Para quien saque al asesor del gestor desde fuera: hace `accion` en el acto si no hay ninguna
 * cartera abierta; si la hay, después de escribir lo pendiente y, si hace falta, de preguntar.
 */
export function salirDelGestorY(accion: () => void): void {
  const pregunta = preguntaActual;
  if (!pregunta) {
    accion();
    return;
  }
  void pregunta().then((sePuede) => {
    if (sePuede) accion();
  });
}
