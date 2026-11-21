// @vitest-environment happy-dom
/**
 * El gestor en Modo cliente (GES-08): las carteras de los demás clientes no se listan ni se
 * ofrecen para comparar (`SE_OCULTA.otrasCarteras`), y los documentos internos del asesor (su
 * informe y los datos en Excel) no se ofrecen (`SE_OCULTA.documentosInternos`). Una cartera ya
 * abierta sigue abierta. Fuera del modo, todo sigue como estaba.
 */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ almacen: null as unknown }));
vi.mock("../../src/gestor/ui/estado/useAlmacen", () => ({
  useAlmacen: () => ({ estado: { fase: "lista", almacen: control.almacen }, error: null, elegir: async () => undefined, reanudar: async () => undefined, olvidar: async () => undefined })
}));
vi.mock("../../src/gestor/informes", () => ({ descargarInformePdf: vi.fn(), descargarExcel: vi.fn() }));

import { ClientModeProvider } from "../../src/app/ClientModeContext";
import type { AlmacenDeCarteras, ResumenDeCartera } from "../../src/gestor/almacen/almacen";
import type { Analisis } from "../../src/gestor/motor/analisis";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { GestorDeCarterasPage } from "../../src/gestor/ui/GestorDeCarterasPage";
import { DialogoDeInformes } from "../../src/gestor/ui/dialogos/DialogoDeInformes";
import { VistaComparar } from "../../src/gestor/ui/vistas/VistaComparar";
import { datosDeLaDemo, pintar, type Pintado } from "./vistaAnalisisDatos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OTRAS: ResumenDeCartera[] = [
  { fichero: "Familia Pérez.cartera.json", id: "p", nombre: "Familia Pérez", cliente: "Ana Pérez", divisaBase: "EUR", movimientos: 12, modificada: "2026-11-01T10:00:00.000Z" },
  { fichero: "Familia Ruiz.cartera.json", id: "r", nombre: "Familia Ruiz", cliente: "Luis Ruiz", divisaBase: "EUR", movimientos: 7, modificada: "2026-10-01T10:00:00.000Z" }
];

const almacenConOtras = () => ({ nombre: "Carteras", listar: async () => OTRAS, leerAjustes: async () => ({}) }) as unknown as AlmacenDeCarteras;

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const enModo = (modoCliente: boolean, nodo: ReactNode) => <ClientModeProvider initialValue={modoCliente}>{nodo}</ClientModeProvider>;

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 100 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 5));
    });
  }
  expect(condicion()).toBe(true);
}

describe("la entrada del gestor en Modo cliente (GES-08)", () => {
  it("fuera del modo lista las carteras de la carpeta, con su cliente", async () => {
    control.almacen = almacenConOtras();
    pintado = await pintar(enModo(false, <GestorDeCarterasPage />));
    await esperar(() => pintado!.vista.textContent!.includes("Familia Pérez"));
    expect(pintado.vista.textContent).toContain("Ana Pérez");
  });

  it("en Modo cliente no lista las demás carteras y dice cómo verlas", async () => {
    control.almacen = almacenConOtras();
    pintado = await pintar(enModo(true, <GestorDeCarterasPage />));
    await act(async () => new Promise((resolver) => setTimeout(resolver, 30)));
    const texto = pintado.vista.textContent ?? "";
    expect(texto).not.toContain("Familia Pérez");
    expect(texto).not.toContain("Ana Pérez");
    expect(texto).toContain("Sal de Modo cliente para ver");
  });
});

describe("Comparar en Modo cliente (GES-08)", () => {
  it("fuera del modo ofrece las otras carteras del gestor", async () => {
    pintado = await pintar(enModo(false, <VistaComparar datos={{ ...datosDeLaDemo(), almacen: almacenConOtras() }} />));
    await esperar(() => pintado!.vista.textContent!.includes("Familia Pérez"));
  });

  it("en Modo cliente no ofrece las carteras «Del gestor» de otros clientes", async () => {
    pintado = await pintar(enModo(true, <VistaComparar datos={{ ...datosDeLaDemo(), almacen: almacenConOtras() }} />));
    await act(async () => new Promise((resolver) => setTimeout(resolver, 30)));
    const texto = pintado.vista.textContent ?? "";
    expect(texto).not.toContain("Familia Pérez");
    expect(texto).not.toContain("Ana Pérez");
    expect(texto).toContain("Sal de Modo cliente para ver otras carteras.");
    /* La abierta sigue en la comparación. */
    expect(texto).toContain("Esta cartera");
  });
});

describe("los informes en Modo cliente (GES-08)", () => {
  const CARTERA = carteraVacia({ nombre: "Familia Prueba", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
  const analisis = { periodo: { desde: "2025-12-31", hasta: "2026-11-13" }, valoracion: { dias: ["2025-01-02"] }, integridad: { errores: 0, avisos: [] } } as unknown as Analisis;
  const documentos = () => [...document.body.querySelectorAll(".rows__label")].map((rotulo) => rotulo.firstChild?.textContent ?? "");

  it("fuera del modo ofrece los cuatro documentos", async () => {
    pintado = await pintar(enModo(false, <DialogoDeInformes alCerrar={() => undefined} almacen={null} analisis={analisis} cartera={CARTERA} />));
    expect(documentos()).toEqual(["Informe del cliente", "Informe de costes", "Informe del asesor", "Datos en Excel"]);
  });

  it("en Modo cliente no ofrece el informe del asesor ni el Excel", async () => {
    pintado = await pintar(enModo(true, <DialogoDeInformes alCerrar={() => undefined} almacen={null} analisis={analisis} cartera={CARTERA} />));
    expect(documentos()).toEqual(["Informe del cliente", "Informe de costes"]);
  });
});
