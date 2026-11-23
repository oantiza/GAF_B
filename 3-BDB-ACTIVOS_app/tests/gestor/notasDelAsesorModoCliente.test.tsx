// @vitest-environment happy-dom
/**
 * La nota del asesor en un movimiento, en pantalla (P1-11, 21-11-2026): fuera de Modo cliente sale donde salía —en los
 * últimos movimientos del resumen, como apunte del libro de movimientos y en el concepto del extracto de la cuenta de
 * efectivo—; en Modo cliente no sale en ninguno de los tres (`SE_OCULTA.notasDelAsesor`). En papel no llega nunca al cliente:
 * lo prueba `notasDelAsesorFueraDelCliente.test.ts`.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientModeProvider } from "../../src/app/ClientModeContext";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import { VistaCuentas } from "../../src/gestor/ui/vistas/VistaCuentas";
import { VistaMovimientos } from "../../src/gestor/ui/vistas/VistaMovimientos";
import { VistaResumen } from "../../src/gestor/ui/vistas/VistaResumen";
import { datosDeVista, HOY, pintar, type Pintado } from "./vistaAnalisisDatos";

const MARCA = "Zqnota";

function datosConNotas() {
  const demo = demostracion(HOY);
  const cartera = { ...demo.cartera, movimientos: demo.cartera.movimientos.map((m, i) => ({ ...m, nota: `${MARCA}${i}` })) };
  return datosDeVista(cartera, { datos: demo.mercado, fichas: demo.fichas, referencia: demo.referencia, avisos: [] }, HOY);
}

const enModo = (modoCliente: boolean, nodo: ReactNode) => <ClientModeProvider initialValue={modoCliente}>{nodo}</ClientModeProvider>;

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const VISTAS: Array<[string, (datos: ReturnType<typeof datosConNotas>) => ReactNode]> = [
  ["el resumen", (datos) => <VistaResumen datos={datos} />],
  ["el libro de movimientos", (datos) => <VistaMovimientos datos={datos} />],
  ["las cuentas", (datos) => <VistaCuentas datos={datos} />]
];

describe("la nota del asesor en pantalla (P1-11)", () => {
  for (const [nombre, vista] of VISTAS) {
    it(`${nombre}: fuera de Modo cliente enseña la nota`, async () => {
      pintado = await pintar(enModo(false, vista(datosConNotas())));
      expect(pintado.vista.textContent).toContain(MARCA);
    });

    it(`${nombre}: en Modo cliente no la enseña`, async () => {
      pintado = await pintar(enModo(true, vista(datosConNotas())));
      const texto = pintado.vista.textContent ?? "";
      expect(texto.length).toBeGreaterThan(200);
      expect(texto).not.toContain(MARCA);
    });
  }
});
