import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../components/ui/ModalDialog";
import {
  almacenDelNavegador,
  crearVigilante,
  cuentaAtras,
  esActividadDeUnaPersona,
  TIEMPOS_DE_INACTIVIDAD,
  type Vigilante
} from "./cierrePorInactividad";

/** Lo que hace una persona. Un temporizador interno o una petición en curso no pasan por aquí. */
const EVENTOS_DE_ACTIVIDAD = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

/**
 * Vigila la sesión mientras hay una abierta y enseña el aviso del último minuto (decisión 46). No pinta nada hasta entonces, y
 * tiene su propio estado para que la cuenta atrás no vuelva a pintar la aplicación entera cada segundo.
 *
 * Los eventos se escuchan en la fase de captura: una pantalla que corte la propagación de una tecla no deja de ser alguien
 * usando la aplicación.
 */
export function VigilanteDeInactividad({ alCerrar }: { alCerrar: () => void }) {
  const [segundos, setSegundos] = useState<number | null>(null);
  const vigilante = useRef<Vigilante | null>(null);
  const alCerrarAlDia = useRef(alCerrar);
  useEffect(() => {
    alCerrarAlDia.current = alCerrar;
  }, [alCerrar]);

  useEffect(() => {
    const actual = crearVigilante({
      ahora: () => Date.now(),
      almacen: almacenDelNavegador(),
      alAvisar: setSegundos,
      alCerrar: () => alCerrarAlDia.current()
    });
    vigilante.current = actual;

    const posicion = { x: null, y: null };
    const alEvento = (evento: Event) => {
      if (esActividadDeUnaPersona(evento, posicion)) actual.actividad();
    };
    /* Volver a la pestaña es actividad. Irse no: se escribe la hora que quedara, para que las otras la tengan. */
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") actual.actividad();
      else actual.volcar();
    };
    const alVolver = () => actual.actividad();
    const alVolverDeLaCache = (evento: PageTransitionEvent) => {
      if (evento.persisted) actual.actividad();
    };
    const alIrse = () => actual.volcar();

    for (const nombre of EVENTOS_DE_ACTIVIDAD) {
      window.addEventListener(nombre, alEvento, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    /* Sin captura a propósito: con ella también llegaría el foco de cualquier elemento, y eso lo mueve el código. */
    window.addEventListener("focus", alVolver);
    window.addEventListener("pageshow", alVolverDeLaCache);
    window.addEventListener("pagehide", alIrse);
    const latido = window.setInterval(actual.comprobar, TIEMPOS_DE_INACTIVIDAD.latidoMs);
    actual.comprobar();

    return () => {
      window.clearInterval(latido);
      for (const nombre of EVENTOS_DE_ACTIVIDAD) {
        window.removeEventListener(nombre, alEvento, { capture: true });
      }
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("pageshow", alVolverDeLaCache);
      window.removeEventListener("pagehide", alIrse);
      /* Sin volcar: esto corre al salir de la sesión, y volvería a escribir la hora que «Salir» acaba de borrar. */
      vigilante.current = null;
    };
  }, []);

  if (segundos === null) return null;
  return <AvisoDeInactividad segundos={segundos} alSeguir={() => vigilante.current?.seguirAqui()} />;
}

/**
 * El aviso. Lleva el mismo texto siempre, y ninguno habla del asesor: con Modo cliente puede salir delante de un cliente.
 * Solo se responde con el botón o con Escape, y un clic fuera no cuenta: si no, un roce con el ratón lo quitaría sin leerlo.
 */
function AvisoDeInactividad({ segundos, alSeguir }: { segundos: number; alSeguir: () => void }) {
  const tituloId = useId();
  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={tituloId} onClose={alSeguir} size="sm">
      <DialogHeader title="Sesión inactiva" titleId={tituloId} />
      <DialogBody>
        <p role="alert">Tu sesión se cerrará en 1 minuto por inactividad. Lo que no esté guardado se perderá.</p>
        <p role="timer">
          Tiempo restante: <strong className="tabular-nums">{cuentaAtras(segundos)}</strong>
        </p>
      </DialogBody>
      <DialogFooter>
        <Button autoFocus onClick={alSeguir} variant="primary">
          Seguir aquí
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
