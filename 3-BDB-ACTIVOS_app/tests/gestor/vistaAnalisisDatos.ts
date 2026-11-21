/**
 * Ayudas para probar las pestañas Análisis y Comparar: un `DatosDeVista` construido con el
 * motor de verdad sobre una cartera, y un pintado con React en un nodo suelto.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AlmacenDeCarteras } from "../../src/gestor/almacen/almacen";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { periodosHabituales, preparar, type IdDePeriodo } from "../../src/gestor/motor/analisis";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { analizarConLaReferencia } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import type { CarteraAbierta } from "../../src/gestor/ui/estado/useCarteraAbierta";
import type { DatosDeVista } from "../../src/gestor/ui/tipos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const HOY = "2026-11-13";

export function datosDeVista(cartera: Cartera, mercado: MercadoCargado, hoy = HOY, elegido: IdDePeriodo = "inicio", almacen: AlmacenDeCarteras | null = null, cambiar: CarteraAbierta["cambiar"] = () => undefined): DatosDeVista {
  const preparado = preparar(cartera, mercado.datos, mercado.fichas, hoy);
  const periodos = periodosHabituales(preparado.valoracion, hoy);
  const periodo = (periodos.find((habitual) => habitual.id === elegido && habitual.disponible) ?? periodos.find((habitual) => habitual.id === "inicio"))!.periodo;
  const analisis = analizarConLaReferencia(preparado, periodo, mercado.referencia);
  const abierta: CarteraAbierta = {
    cartera,
    guardado: "guardado",
    errorDeGuardado: null,
    codigoDeError: null,
    fichero: null,
    accionADeshacer: null,
    accionARehacer: null,
    cambiosQueSePerderian: false,
    cambiar,
    deshacer: () => undefined,
    rehacer: () => undefined,
    guardarAhora: async () => undefined,
    descargarCopia: () => undefined,
    volverADarPermiso: async () => undefined,
    recargarDelDisco: async () => undefined,
    guardarComoCopia: async () => undefined,
    prepararSalida: async () => false,
    descartarCambios: () => undefined,
    retirar: async () => false
  };
  return {
    abierta,
    analisis,
    preparado,
    periodos,
    periodo,
    elegido: { id: elegido },
    hoy,
    mercado: { mercado, cargando: false, error: null, reintentar: () => undefined },
    almacen,
    irA: () => undefined,
    nuevoMovimiento: () => undefined,
    editarMovimiento: () => undefined
  };
}

/** La cartera de demostración, desde el inicio, con su índice de referencia. */
export function datosDeLaDemo(elegido: IdDePeriodo = "inicio"): DatosDeVista {
  const demo = demostracion(HOY);
  return datosDeVista(demo.cartera, { datos: demo.mercado, fichas: demo.fichas, referencia: demo.referencia, avisos: [] }, HOY, elegido);
}

export interface Pintado {
  vista: HTMLDivElement;
  desmontar(): Promise<void>;
}

export async function pintar(nodo: ReactNode): Promise<Pintado> {
  const vista = document.createElement("div");
  document.body.append(vista);
  const raiz: Root = createRoot(vista);
  await act(async () => raiz.render(nodo));
  return {
    vista,
    desmontar: async () => {
      await act(async () => raiz.unmount());
      vista.remove();
    }
  };
}

/** Los títulos de bloque que hay en la vista, en orden. */
export function titulos(vista: HTMLElement): string[] {
  return [...vista.querySelectorAll(".panel__title")].map((titulo) => titulo.textContent ?? "");
}

/** El panel cuyo título es `titulo`. */
export function panel(vista: HTMLElement, titulo: string): HTMLElement {
  const encontrado = [...vista.querySelectorAll<HTMLElement>("section.panel")].find((seccion) => seccion.querySelector(".panel__title")?.textContent === titulo);
  if (!encontrado) throw new Error(`No hay un bloque «${titulo}».`);
  return encontrado;
}
