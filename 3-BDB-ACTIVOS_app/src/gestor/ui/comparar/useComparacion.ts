/**
 * El estado de la comparación: las carteras del gestor que se pueden elegir y el cálculo de
 * cada candidata elegida. Cada cálculo va por su cuenta: uno que falla no tumba los demás.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlmacenDeCarteras, ResumenDeCartera } from "../../almacen/almacen";
import { catalogoDeActivos, fuenteDeLaPlataforma } from "../../mercado/plataforma";
import type { Dia } from "../../motor/fechas";
import { analizarCandidata, claveDelCalculo, type Candidata, type CarteraComparada } from "./calcular";

export type EstadoDelCalculo = { estado: "cargando" } | { estado: "listo"; comparada: CarteraComparada } | { estado: "error"; mensaje: string };

export type ListaDelGestor =
  | { estado: "sin-carpeta" }
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; carteras: ResumenDeCartera[] };

/** Las carteras de la carpeta, sin la que está abierta. */
export function useCarterasDelGestor(almacen: AlmacenDeCarteras | null, abierta: { id: string; fichero: string | null }): ListaDelGestor {
  const [leida, setLeida] = useState<{ almacen: AlmacenDeCarteras; lista: ListaDelGestor } | null>(null);
  useEffect(() => {
    if (!almacen) return;
    let vigente = true;
    almacen
      .listar()
      .then((carteras) => {
        if (vigente) setLeida({ almacen, lista: { estado: "listo", carteras } });
      })
      .catch((causa: unknown) => {
        if (vigente) setLeida({ almacen, lista: { estado: "error", mensaje: causa instanceof Error ? causa.message : "No se ha podido leer la carpeta." } });
      });
    return () => {
      vigente = false;
    };
  }, [almacen]);
  if (!almacen) return { estado: "sin-carpeta" };
  if (!leida || leida.almacen !== almacen) return { estado: "cargando" };
  if (leida.lista.estado !== "listo") return leida.lista;
  /* Con fichero, se quita por fichero: dos ficheros copiados uno de otro comparten id, y el otro sí se puede comparar (GES-14). */
  return { estado: "listo", carteras: leida.lista.carteras.filter((resumen) => (abierta.fichero ? resumen.fichero !== abierta.fichero : resumen.id !== abierta.id)) };
}

export interface ParametrosDeComparacion {
  desde: Dia;
  hasta: Dia;
  hoy: Dia;
  divisaBase: string;
  capital: number;
  almacen: AlmacenDeCarteras | null;
}

/** Calcula cada candidata elegida en el periodo común, una vez por periodo. */
export function useComparacion(elegidas: readonly Candidata[], parametros: ParametrosDeComparacion) {
  const { desde, hasta, hoy, divisaBase, capital, almacen } = parametros;
  const [resultados, setResultados] = useState<ReadonlyMap<string, EstadoDelCalculo>>(new Map());
  const [intento, setIntento] = useState(0);
  /* Lo que ya se ha pedido: un cálculo no se repite al volver a pintar ni al elegir otra candidata. */
  const pedidos = useRef(new Set<string>());

  useEffect(() => {
    const periodo = { desde, hasta };
    for (const candidata of elegidas) {
      const clave = claveDelCalculo(candidata, periodo);
      if (pedidos.current.has(clave)) continue;
      pedidos.current.add(clave);
      analizarCandidata(candidata, { periodo, hoy, divisaBase, capital, almacen, fuente: fuenteDeLaPlataforma, catalogo: catalogoDeActivos })
        .then((comparada) => setResultados((previos) => new Map(previos).set(clave, { estado: "listo", comparada })))
        .catch((causa: unknown) => {
          setResultados((previos) => new Map(previos).set(clave, { estado: "error", mensaje: causa instanceof Error ? causa.message : "No se ha podido calcular." }));
        });
    }
  }, [elegidas, desde, hasta, hoy, divisaBase, capital, almacen, intento]);

  const estadoDe = useCallback(
    (candidata: Candidata): EstadoDelCalculo => resultados.get(claveDelCalculo(candidata, { desde, hasta })) ?? { estado: "cargando" },
    [resultados, desde, hasta]
  );

  const reintentar = useCallback(
    (candidata: Candidata) => {
      const clave = claveDelCalculo(candidata, { desde, hasta });
      pedidos.current.delete(clave);
      setResultados((previos) => {
        const siguientes = new Map(previos);
        siguientes.delete(clave);
        return siguientes;
      });
      setIntento((n) => n + 1);
    },
    [desde, hasta]
  );

  return { estadoDe, reintentar };
}
