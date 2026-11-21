/**
 * Dónde se guardan las carteras: el estado de la carpeta del usuario.
 *
 * La primera vez el asesor elige una carpeta de su disco. El navegador recuerda el permiso
 * (no el contenido) y en la siguiente visita basta un clic para volver a entrar. En un
 * navegador sin acceso a carpetas, el gestor trabaja con ficheros sueltos: abrir y descargar.
 *
 * La carpeta se recuerda POR USUARIO (GES-13): la que eligió quien tiene la sesión abierta, y
 * a nadie más (`almacen/acceso.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { useAuthSession } from "../../../auth/AuthSessionContext";
import { carpetaRecordada, elegirCarpeta, hayAccesoACarpetas, olvidarCarpeta, permisoDe, recordarCarpeta } from "../../almacen/acceso";
import type { AlmacenDeCarteras } from "../../almacen/almacen";
import { almacenEnCarpeta } from "../../almacen/carpeta";

export type EstadoDelAlmacen =
  /** Mirando si hay una carpeta recordada. */
  | { fase: "comprobando" }
  /** El navegador no puede leer ni escribir en una carpeta: se trabaja con ficheros sueltos. */
  | { fase: "sin-acceso" }
  /** Nunca se ha elegido carpeta (o se olvidó). */
  | { fase: "sin-carpeta" }
  /** Hay una carpeta recordada, pero el navegador pide que el usuario vuelva a dar permiso con un clic. */
  | { fase: "falta-permiso"; nombre: string }
  | { fase: "lista"; almacen: AlmacenDeCarteras };

export interface ControlDelAlmacen {
  estado: EstadoDelAlmacen;
  error: string | null;
  /** Abre el diálogo del sistema para elegir la carpeta de carteras. */
  elegir(): Promise<void>;
  /** Vuelve a pedir permiso para la carpeta recordada. Tiene que llamarse desde un clic. */
  reanudar(): Promise<void>;
  /** Deja de usar la carpeta. No borra nada del disco. */
  olvidar(): Promise<void>;
}

/**
 * Solo en desarrollo, y solo con `?carpeta=prueba` en la dirección: una carpeta privada del
 * navegador que hace de carpeta de carteras, para poder probar la pantalla de forma automática
 * (el diálogo del sistema para elegir carpeta no se puede manejar desde una prueba). En la
 * aplicación publicada esta rama no existe: las carteras van siempre al disco del usuario.
 */
async function carpetaDePrueba(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  if (new URLSearchParams(window.location.search).get("carpeta") !== "prueba") return undefined;
  const raiz = await navigator.storage.getDirectory();
  return raiz.getDirectoryHandle("carteras-de-prueba", { create: true });
}

export function useAlmacen(): ControlDelAlmacen {
  /* Quién tiene la sesión: la carpeta es suya. Sin sesión (la app sin autenticación) no se recuerda. */
  const usuario = useAuthSession()?.uid;
  const [estado, setEstado] = useState<EstadoDelAlmacen>({ fase: "comprobando" });
  const [error, setError] = useState<string | null>(null);
  const [recordada, setRecordada] = useState<FileSystemDirectoryHandle | undefined>();

  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const dePrueba = await carpetaDePrueba();
        if (dePrueba) {
          if (vigente) setEstado({ fase: "lista", almacen: almacenEnCarpeta(dePrueba) });
          return;
        }
        if (!hayAccesoACarpetas()) {
          if (vigente) setEstado({ fase: "sin-acceso" });
          return;
        }
        const carpeta = await carpetaRecordada(usuario);
        if (!vigente) return;
        if (!carpeta) {
          setEstado({ fase: "sin-carpeta" });
          return;
        }
        setRecordada(carpeta);
        const permiso = await permisoDe(carpeta, false);
        if (!vigente) return;
        setEstado(permiso === "concedido" ? { fase: "lista", almacen: almacenEnCarpeta(carpeta) } : { fase: "falta-permiso", nombre: carpeta.name });
      } catch {
        if (vigente) setEstado({ fase: hayAccesoACarpetas() ? "sin-carpeta" : "sin-acceso" });
      }
    })();
    return () => {
      vigente = false;
    };
  }, [usuario]);

  const elegir = useCallback(async () => {
    setError(null);
    try {
      const carpeta = await elegirCarpeta();
      if (!carpeta) return;
      await recordarCarpeta(carpeta, usuario);
      setRecordada(carpeta);
      setEstado({ fase: "lista", almacen: almacenEnCarpeta(carpeta) });
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No se ha podido abrir la carpeta.");
    }
  }, [usuario]);

  const reanudar = useCallback(async () => {
    if (!recordada) return;
    setError(null);
    try {
      const permiso = await permisoDe(recordada, true);
      if (permiso === "concedido") setEstado({ fase: "lista", almacen: almacenEnCarpeta(recordada) });
      else setError("El navegador no ha dado permiso para la carpeta. Vuelve a intentarlo o elige la carpeta de nuevo.");
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No se ha podido volver a abrir la carpeta.");
    }
  }, [recordada]);

  const olvidar = useCallback(async () => {
    await olvidarCarpeta(usuario);
    setRecordada(undefined);
    setError(null);
    setEstado({ fase: hayAccesoACarpetas() ? "sin-carpeta" : "sin-acceso" });
  }, [usuario]);

  return { estado, error, elegir, reanudar, olvidar };
}
