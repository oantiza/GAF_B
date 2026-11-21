/**
 * El registro de tipos de movimiento.
 *
 * AÑADIR UN TIPO: crea su módulo en esta carpeta, expórtalo como `DefinicionDeMovimiento`
 * y añádelo a `TIPOS`. Nada más: el libro, el formulario y los informes lo leen de aquí.
 * `tests/gestor/tiposDeMovimiento.test.ts` comprueba que todo tipo registrado cuadra.
 */
import type { DefinicionDeMovimiento, GrupoDeMovimiento } from "../efectos";
import { amortizacion } from "./amortizacion";
import { aportacion } from "./aportacion";
import { cambioDeDivisa } from "./cambioDeDivisa";
import { canje } from "./canje";
import { comision } from "./comision";
import { compra } from "./compra";
import { cupon } from "./cupon";
import { dividendo } from "./dividendo";
import { dividendoEnAcciones } from "./dividendoEnAcciones";
import { entradaDeTitulos } from "./entradaDeTitulos";
import { extincionDeTitulos } from "./extincionDeTitulos";
import { interes } from "./interes";
import { otroEfectivo } from "./otroEfectivo";
import { reembolso } from "./reembolso";
import { retencion } from "./retencion";
import { retirada } from "./retirada";
import { salidaDeTitulos } from "./salidaDeTitulos";
import { split } from "./split";
import { suscripcion } from "./suscripcion";
import { traspaso } from "./traspaso";
import { venta } from "./venta";

/** Todos los tipos, en el orden en que los ofrece el formulario. */
export const TIPOS: readonly DefinicionDeMovimiento[] = [
  compra,
  venta,
  suscripcion,
  reembolso,
  traspaso,
  aportacion,
  retirada,
  dividendo,
  cupon,
  interes,
  comision,
  retencion,
  cambioDeDivisa,
  otroEfectivo,
  entradaDeTitulos,
  salidaDeTitulos,
  extincionDeTitulos,
  dividendoEnAcciones,
  split,
  canje,
  amortizacion
];

const POR_TIPO: ReadonlyMap<string, DefinicionDeMovimiento> = new Map(TIPOS.map((definicion) => [definicion.tipo, definicion]));

if (POR_TIPO.size !== TIPOS.length) throw new Error("Hay dos tipos de movimiento registrados con la misma clave.");

export function definicionDe(tipo: string): DefinicionDeMovimiento | undefined {
  return POR_TIPO.get(tipo);
}

export function nombreDelTipo(tipo: string): string {
  return POR_TIPO.get(tipo)?.nombre ?? tipo;
}

export function tiposDelGrupo(grupo: GrupoDeMovimiento): DefinicionDeMovimiento[] {
  return TIPOS.filter((definicion) => definicion.grupo === grupo);
}
