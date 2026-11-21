import { useEffect, useState } from "react";

/**
 * Si esta pestaña se abrió con otra de la aplicación ya abierta. Decisión 29 de Óscar (04-11-2026).
 *
 * En la web la cartera activa vive en cada pestaña (`sessionStorage`), porque es de un cliente y no
 * se guarda en disco. Así que si el asesor abre una ficha en otra pestaña y allí pulsa Añadir, la
 * posición no llega a la primera. Óscar eligió que la pestaña nueva lo diga, antes que compartir la
 * cartera guardándola en el navegador.
 *
 * Para saber si hay otra basta con preguntar en voz alta por un `BroadcastChannel`, que solo existe
 * mientras las pestañas están abiertas: **no se escribe nada en disco**, y por el canal solo viaja un
 * identificador al azar, ningún dato de la cartera.
 *
 * - Al abrirse, una pestaña dice «hola»; las que ya estaban le contestan «aquí estoy» a ella. El canal
 *   es de difusión, así que la respuesta lleva a quién va: si no, con tres pestañas la primera también
 *   se apuntaba a la segunda y pasaba a avisar. Quien ya estaba no cambia nada: su cartera sigue siendo
 *   la que era, y no hay nada que avisarle.
 * - Al cerrarse dice «adiós». Si se cierran todas las anteriores, esta deja de avisar.
 */
const CANAL = "gestor-activos.pestanas.v1";

type Mensaje = { tipo: "hola" | "adios"; id: string } | { tipo: "aqui"; id: string; para: string };

export function useOtraPestana(): boolean {
  const [hayOtra, setHayOtra] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const id = Math.random().toString(36).slice(2);
    const canal = new BroadcastChannel(CANAL);
    const anteriores = new Set<string>();
    const decir = (tipo: "hola" | "adios") => canal.postMessage({ tipo, id } satisfies Mensaje);

    canal.onmessage = ({ data }: MessageEvent<Mensaje>) => {
      if (data.tipo === "hola") {
        canal.postMessage({ tipo: "aqui", id, para: data.id } satisfies Mensaje);
        return;
      }
      if (data.tipo === "aqui") {
        if (data.para !== id) return;
        anteriores.add(data.id);
      } else {
        anteriores.delete(data.id);
      }
      setHayOtra(anteriores.size > 0);
    };

    const alSalir = () => decir("adios");
    /* Una pestaña que vuelve de la caché del navegador ya se había despedido. */
    const alVolver = (evento: PageTransitionEvent) => {
      if (evento.persisted) decir("hola");
    };
    window.addEventListener("pagehide", alSalir);
    window.addEventListener("pageshow", alVolver);
    decir("hola");

    return () => {
      window.removeEventListener("pagehide", alSalir);
      window.removeEventListener("pageshow", alVolver);
      decir("adios");
      canal.close();
    };
  }, []);

  return hayOtra;
}
