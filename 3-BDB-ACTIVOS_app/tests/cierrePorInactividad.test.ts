/**
 * Decisión 46 de Óscar (05-11-2026): la sesión se cierra a los 30 minutos sin usarla, con aviso un minuto antes. Aquí, la
 * lógica con un reloj falso, sin navegador. Las horas se cuentan en minutos desde que empieza cada prueba: las cuentas se
 * pueden hacer a mano.
 */
import { describe, expect, test, vi } from "vitest";
import {
  CLAVE_ULTIMA_ACTIVIDAD,
  crearVigilante,
  cuentaAtras,
  esActividadDeUnaPersona,
  faseDeInactividad,
  haCaducadoLaSesion,
  leerUltimaActividad,
  segundosDeCuentaAtras,
  TIEMPOS_DE_INACTIVIDAD,
  type AlmacenDeActividad
} from "../src/auth/cierrePorInactividad";

const MINUTO = 60_000;
const INICIO = Date.UTC(2026, 10, 5, 9, 0, 0);

function almacenDePrueba(inicial?: number): AlmacenDeActividad & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  if (inicial !== undefined) datos.set(CLAVE_ULTIMA_ACTIVIDAD, String(inicial));
  return {
    datos,
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave)
  };
}

/** Un vigilante con su reloj, como una pestaña. Dos que compartan almacén son dos pestañas de la misma sesión. */
function pestana(almacen: AlmacenDeActividad | null, inicio = INICIO) {
  const reloj = { ahora: inicio };
  const avisos: Array<number | null> = [];
  const alCerrar = vi.fn();
  const vigilante = crearVigilante({
    ahora: () => reloj.ahora,
    almacen,
    alAvisar: (segundos) => avisos.push(segundos),
    alCerrar
  });
  const avanzar = (ms: number) => {
    reloj.ahora += ms;
  };
  /** Pasa el tiempo con el latido corriendo, como con la aplicación abierta. */
  const correr = (ms: number) => {
    const fin = reloj.ahora + ms;
    while (reloj.ahora < fin) {
      reloj.ahora = Math.min(reloj.ahora + TIEMPOS_DE_INACTIVIDAD.latidoMs, fin);
      vigilante.comprobar();
    }
  };
  return { reloj, vigilante, avisos, alCerrar, avanzar, correr };
}

describe("las fases, con las cuentas hechas a mano", () => {
  test("los tiempos son los de la decisión: 30 minutos, y el aviso un minuto antes", () => {
    expect(TIEMPOS_DE_INACTIVIDAD.cierreMs).toBe(1_800_000);
    expect(TIEMPOS_DE_INACTIVIDAD.avisoAntesMs).toBe(60_000);
  });

  test.each([
    [0, "en-uso"],
    [28 * MINUTO, "en-uso"],
    /* A los 29 minutos justos faltan 60 segundos: ya se avisa. Un milisegundo antes, todavía no. */
    [29 * MINUTO - 1, "en-uso"],
    [29 * MINUTO, "aviso"],
    [30 * MINUTO - 1, "aviso"],
    [30 * MINUTO, "cerrar"],
    [8 * 60 * MINUTO, "cerrar"]
  ])("a los %d ms sin actividad: %s", (transcurrido, fase) => {
    expect(faseDeInactividad(INICIO + transcurrido, INICIO).fase).toBe(fase);
  });

  test("lo que queda en el último minuto", () => {
    expect(faseDeInactividad(INICIO + 29 * MINUTO + 15_000, INICIO)).toEqual({ fase: "aviso", restanteMs: 45_000 });
  });

  test("una hora futura es un reloj que ha ido hacia atrás: no ha pasado tiempo, y el plazo no es mayor de 30 minutos", () => {
    expect(faseDeInactividad(INICIO, INICIO + 60 * MINUTO).fase).toBe("en-uso");
    expect(faseDeInactividad(INICIO + 29 * MINUTO, INICIO + 60 * MINUTO).fase).toBe("en-uso");
  });

  test("la cuenta atrás sube al segundo siguiente, para no decir 0:00 mientras quede tiempo", () => {
    expect(segundosDeCuentaAtras(60_000)).toBe(60);
    expect(segundosDeCuentaAtras(59_001)).toBe(60);
    expect(segundosDeCuentaAtras(1)).toBe(1);
    expect(cuentaAtras(60)).toBe("1:00");
    expect(cuentaAtras(59)).toBe("0:59");
    expect(cuentaAtras(5)).toBe("0:05");
    expect(cuentaAtras(0)).toBe("0:00");
  });
});

describe("el vigilante", () => {
  test("avisa a los 29 minutos con la cuenta atrás, y cierra a los 30, una sola vez", () => {
    const { correr, avisos, alCerrar, vigilante, reloj } = pestana(almacenDePrueba());
    correr(29 * MINUTO - 1000);
    expect(avisos).toEqual([]);
    correr(1000);
    expect(avisos).toEqual([60]);
    correr(15_000);
    expect(avisos.at(-1)).toBe(45);
    expect(alCerrar).not.toHaveBeenCalled();
    correr(45_000);
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(avisos.at(-1)).toBeNull();
    reloj.ahora += 5 * MINUTO;
    vigilante.comprobar();
    vigilante.actividad();
    vigilante.seguirAqui();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("la actividad vuelve a empezar la cuenta", () => {
    const { correr, vigilante, avisos, alCerrar } = pestana(almacenDePrueba());
    correr(20 * MINUTO);
    vigilante.actividad();
    correr(29 * MINUTO - 1000);
    expect(avisos).toEqual([]);
    correr(1000);
    expect(avisos).toEqual([60]);
    expect(alCerrar).not.toHaveBeenCalled();
  });

  test("el latido no es actividad: por mucho que corra, no aplaza nada", () => {
    const { correr, alCerrar } = pestana(almacenDePrueba());
    correr(30 * MINUTO);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("mientras se avisa, tocar la pantalla no quita el aviso: solo responder", () => {
    const { correr, vigilante, avisos, alCerrar, reloj } = pestana(almacenDePrueba());
    correr(29 * MINUTO + 10_000);
    expect(avisos.at(-1)).toBe(50);
    vigilante.actividad();
    expect(avisos.at(-1)).toBe(50);
    correr(40_000);
    expect(alCerrar).not.toHaveBeenCalled();
    vigilante.seguirAqui();
    expect(avisos.at(-1)).toBeNull();
    /* Y a partir de la respuesta, otros 30 minutos. */
    const respuesta = reloj.ahora;
    correr(29 * MINUTO);
    expect(reloj.ahora).toBe(respuesta + 29 * MINUTO);
    expect(avisos.at(-1)).toBe(60);
  });

  test("una respuesta que llega con los 30 minutos pasados se cierra igual", () => {
    const { correr, vigilante, avanzar, alCerrar } = pestana(almacenDePrueba());
    correr(29 * MINUTO + 30_000);
    avanzar(5 * MINUTO);
    vigilante.seguirAqui();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  describe("el portátil se duerme", () => {
    test("más de 30 minutos: el primer movimiento al volver cierra, no salva la sesión", () => {
      const { avanzar, vigilante, alCerrar } = pestana(almacenDePrueba());
      avanzar(45 * MINUTO);
      vigilante.actividad();
      expect(alCerrar).toHaveBeenCalledTimes(1);
    });

    test("más de 30 minutos, y sin que nadie toque nada: lo cierra el primer latido", () => {
      const { avanzar, vigilante, alCerrar } = pestana(almacenDePrueba());
      avanzar(8 * 60 * MINUTO);
      vigilante.comprobar();
      expect(alCerrar).toHaveBeenCalledTimes(1);
    });

    test("menos de 29: al volver, la sesión sigue, y el movimiento cuenta", () => {
      const { avanzar, vigilante, alCerrar, avisos, correr } = pestana(almacenDePrueba());
      avanzar(20 * MINUTO);
      vigilante.actividad();
      expect(alCerrar).not.toHaveBeenCalled();
      correr(28 * MINUTO);
      expect(avisos).toEqual([]);
    });

    test("entre 29 y 30: al volver sale el aviso con lo que queda de verdad, sin un minuto de regalo", () => {
      const { avanzar, vigilante, alCerrar, avisos } = pestana(almacenDePrueba());
      avanzar(29 * MINUTO + 40_000);
      vigilante.actividad();
      expect(alCerrar).not.toHaveBeenCalled();
      expect(avisos).toEqual([20]);
    });
  });

  describe("el reloj se atrasa", () => {
    test("una hora guardada del futuro se corrige, y la sesión se cierra a su tiempo", () => {
      const almacen = almacenDePrueba(INICIO + 24 * 60 * MINUTO);
      const { correr, alCerrar } = pestana(almacen);
      expect(leerUltimaActividad(almacen)).toBe(INICIO);
      correr(30 * MINUTO);
      expect(alCerrar).toHaveBeenCalledTimes(1);
    });

    test("con la pestaña abierta también: no se queda abierta hasta que el reloj vuelva a esa hora", () => {
      const almacen = almacenDePrueba();
      const { reloj, correr, alCerrar } = pestana(almacen);
      reloj.ahora -= 24 * 60 * MINUTO;
      /* El primer latido corrige la hora, y desde ahí cuenta: un latido más que los 30 minutos. */
      correr(30 * MINUTO + TIEMPOS_DE_INACTIVIDAD.latidoMs);
      expect(alCerrar).toHaveBeenCalledTimes(1);
    });
  });

  describe("varias pestañas de la misma sesión", () => {
    test("la que está en uso mantiene viva a la otra", () => {
      const almacen = almacenDePrueba();
      const enUso = pestana(almacen);
      const quieta = pestana(almacen);
      for (let minuto = 0; minuto < 90; minuto += 1) {
        enUso.avanzar(MINUTO);
        quieta.avanzar(MINUTO);
        enUso.vigilante.actividad();
        quieta.vigilante.comprobar();
      }
      expect(quieta.alCerrar).not.toHaveBeenCalled();
      expect(quieta.avisos).toEqual([]);
    });

    test("una respuesta al aviso en una quita el aviso de la otra", () => {
      const almacen = almacenDePrueba();
      const una = pestana(almacen);
      const otra = pestana(almacen);
      una.correr(29 * MINUTO + 5000);
      otra.correr(29 * MINUTO + 5000);
      expect(una.avisos.at(-1)).toBe(55);
      expect(otra.avisos.at(-1)).toBe(55);
      una.vigilante.seguirAqui();
      otra.vigilante.comprobar();
      expect(otra.avisos.at(-1)).toBeNull();
    });

    test("sin nadie en ninguna, se cierran las dos", () => {
      const almacen = almacenDePrueba();
      const una = pestana(almacen);
      const otra = pestana(almacen);
      una.correr(30 * MINUTO);
      otra.correr(30 * MINUTO);
      expect(una.alCerrar).toHaveBeenCalledTimes(1);
      expect(otra.alCerrar).toHaveBeenCalledTimes(1);
    });

    test("la actividad llega a la otra en un momento, aunque se escriba de vez en cuando", () => {
      const almacen = almacenDePrueba();
      const { reloj, vigilante, correr } = pestana(almacen);
      correr(10 * MINUTO);
      vigilante.actividad();
      /* La primera tras un rato se escribe en el acto. */
      expect(leerUltimaActividad(almacen)).toBe(reloj.ahora);
      const primera = reloj.ahora;
      reloj.ahora += 1000;
      vigilante.actividad();
      /* La siguiente, un segundo después, se queda en memoria… */
      expect(leerUltimaActividad(almacen)).toBe(primera);
      const segunda = reloj.ahora;
      correr(TIEMPOS_DE_INACTIVIDAD.escrituraCadaMs);
      /* …y la escribe el latido. */
      expect(leerUltimaActividad(almacen)).toBe(segunda);
    });

    test("al irse, la pestaña escribe lo que le quedaba", () => {
      const almacen = almacenDePrueba();
      const { reloj, vigilante } = pestana(almacen);
      reloj.ahora += 10 * MINUTO;
      vigilante.actividad();
      reloj.ahora += 1000;
      vigilante.actividad();
      vigilante.volcar();
      expect(leerUltimaActividad(almacen)).toBe(reloj.ahora);
    });
  });

  test("sin almacén, cada pestaña cuenta por su cuenta y el cierre funciona igual", () => {
    const { correr, alCerrar, avisos } = pestana(null);
    correr(30 * MINUTO);
    expect(avisos).toContain(60);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("un almacén que falla no rompe nada", () => {
    const roto: AlmacenDeActividad = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      }
    };
    const { correr, alCerrar } = pestana(roto);
    correr(30 * MINUTO);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("en el almacén solo hay una hora", () => {
    const almacen = almacenDePrueba();
    const { correr, vigilante } = pestana(almacen);
    correr(5 * MINUTO);
    vigilante.actividad();
    expect([...almacen.datos.keys()]).toEqual([CLAVE_ULTIMA_ACTIVIDAD]);
    expect(almacen.datos.get(CLAVE_ULTIMA_ACTIVIDAD)).toMatch(/^\d+$/);
  });
});

describe("una sesión que venía de antes", () => {
  test("con la hora caducada no se abre; sin hora, o con una reciente, sí", () => {
    expect(haCaducadoLaSesion(INICIO + 31 * MINUTO, almacenDePrueba(INICIO))).toBe(true);
    expect(haCaducadoLaSesion(INICIO + 30 * MINUTO, almacenDePrueba(INICIO))).toBe(true);
    expect(haCaducadoLaSesion(INICIO + 29 * MINUTO, almacenDePrueba(INICIO))).toBe(false);
    expect(haCaducadoLaSesion(INICIO, almacenDePrueba())).toBe(false);
    expect(haCaducadoLaSesion(INICIO, null)).toBe(false);
  });

  test("basura en el almacén no es una hora", () => {
    const almacen = almacenDePrueba();
    almacen.datos.set(CLAVE_ULTIMA_ACTIVIDAD, "no es una hora");
    expect(leerUltimaActividad(almacen)).toBeNull();
    expect(haCaducadoLaSesion(INICIO, almacen)).toBe(false);
  });
});

describe("qué es actividad de una persona", () => {
  const posicion = () => ({ x: null as number | null, y: null as number | null });

  test.each(["keydown", "pointerdown", "wheel", "touchstart"])("%s lo es", (type) => {
    expect(esActividadDeUnaPersona({ type, isTrusted: true }, posicion())).toBe(true);
  });

  test("lo lanzado por código no lo es", () => {
    expect(esActividadDeUnaPersona({ type: "keydown", isTrusted: false }, posicion())).toBe(false);
  });

  test("un movimiento de ratón solo cuenta si cambia la posición: el navegador los manda sin que nadie mueva nada", () => {
    const donde = posicion();
    expect(esActividadDeUnaPersona({ type: "pointermove", isTrusted: true, screenX: 10, screenY: 20 }, donde)).toBe(true);
    expect(esActividadDeUnaPersona({ type: "pointermove", isTrusted: true, screenX: 10, screenY: 20 }, donde)).toBe(false);
    expect(esActividadDeUnaPersona({ type: "pointermove", isTrusted: true, screenX: 11, screenY: 20 }, donde)).toBe(true);
  });
});
