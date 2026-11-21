import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Cifra, type CifraProps } from "../../src/components/ui/Cifra";

/**
 * La pieza Cifra: el único sitio que decide el formato, el color y la ausencia de una cifra en pantalla.
 *
 * Cada texto esperado está escrito a mano con las reglas del apartado 6 de `SISTEMA_DISENO.md`, no copiado de la
 * salida: punto de millar siempre, espacio duro antes de la unidad, el menos tipográfico, y lo que redondea a cero
 * escrito como cero, sin signo y sin color.
 */
const N = " "; // espacio duro
const M = "−"; // menos tipográfico

const pinta = (props: CifraProps) => renderToStaticMarkup(<Cifra {...props} />);
const tinta = (texto: string) => `<span class="cifra">${texto}</span>`;
const sube = (texto: string) => `<span class="cifra cifra--sube">${texto}</span>`;
const baja = (texto: string) => `<span class="cifra cifra--baja">${texto}</span>`;

describe("la cifra escrita: formato y color", () => {
  test.each<[string, CifraProps, string]>([
    ["importe en tabla", { tipo: "importe", valor: 1234.56 }, tinta(`1.234,56${N}€`)],
    ["importe en otra divisa", { tipo: "importe", valor: 1234.5, divisa: "USD" }, tinta(`1.234,50${N}USD`)],
    ["resultado: signo y color, pedidos", { tipo: "importe", valor: 18582, conSigno: true, colorDeSigno: true }, sube(`+18.582,00${N}€`)],
    ["resultado negativo con color", { tipo: "importe", valor: -310.5, colorDeSigno: true }, baja(`${M}310,50${N}€`)],
    ["un movimiento: sin color por defecto", { tipo: "importe", valor: -2500 }, tinta(`${M}2.500,00${N}€`)],
    ["importe que redondea a cero: ni signo ni color", { tipo: "importe", valor: -0.004, conSigno: true, colorDeSigno: true }, tinta(`0,00${N}€`)],
    ["importe titular, sin decimales", { tipo: "importeTitular", valor: 201298.4 }, tinta(`201.298${N}€`)],
    ["importe titular que redondea a cero", { tipo: "importeTitular", valor: -0.4, colorDeSigno: true }, tinta(`0${N}€`)],
    ["importe grande, en millones", { tipo: "importeGrande", valor: 2304300000 }, tinta(`2.304,3${N}M€`)],
    ["rentabilidad positiva: signo y verde", { tipo: "rentabilidad", valor: 0.1039 }, sube(`+10,39${N}%`)],
    ["rentabilidad negativa: menos y rojo", { tipo: "rentabilidad", valor: -0.0472 }, baja(`${M}4,72${N}%`)],
    ["rentabilidad que redondea a cero por arriba", { tipo: "rentabilidad", valor: 0.00004 }, tinta(`0,00${N}%`)],
    ["rentabilidad que redondea a cero por abajo: nunca «−0,00»", { tipo: "rentabilidad", valor: -0.00004 }, tinta(`0,00${N}%`)],
    ["rentabilidad sin color, si se pide", { tipo: "rentabilidad", valor: 0.1039, colorDeSigno: false }, tinta(`+10,39${N}%`)],
    ["rentabilidad con un decimal", { tipo: "rentabilidad", valor: 0.1039, decimales: 1 }, sube(`+10,4${N}%`)],
    ["volatilidad: sin color", { tipo: "porcentaje", valor: 0.078 }, tinta(`7,80${N}%`)],
    ["caída máxima: negativa y sin color", { tipo: "porcentaje", valor: -0.114 }, tinta(`${M}11,40${N}%`)],
    ["peso, con un decimal", { tipo: "peso", valor: 0.24 }, tinta(`24,0${N}%`)],
    ["puntos porcentuales, con signo y color", { tipo: "puntos", valor: 0.0125 }, sube(`+1,25${N}pp`)],
    ["puntos que redondean a cero", { tipo: "puntos", valor: -0.00004 }, tinta(`0,00${N}pp`)],
    ["ratio", { tipo: "ratio", valor: 1.18 }, tinta("1,18")],
    ["precio", { tipo: "precio", valor: 535.02 }, tinta(`535,02${N}€`)],
    ["precio con cuatro decimales, en dólares", { tipo: "precio", valor: 1.0834, divisa: "USD" }, tinta(`1,0834${N}USD`)],
    ["participaciones", { tipo: "titulos", valor: 17.6642 }, tinta("17,6642")],
    ["títulos enteros, con millar", { tipo: "titulos", valor: 1051 }, tinta("1.051")],
    ["un número", { tipo: "numero", valor: 1334 }, tinta("1.334")]
  ])("%s", (_caso, props, esperado) => {
    expect(pinta(props)).toBe(esperado);
  });
});

describe("la cifra que no está", () => {
  test.each<[string, CifraProps, string]>([
    ["sin valor: «Falta el dato» por defecto", { tipo: "rentabilidad", valor: null }, '<span class="ausencia ausencia--falta">Falta el dato</span>'],
    ["no aplica", { tipo: "porcentaje", valor: undefined, ausencia: "no-aplica" }, '<span class="ausencia ausencia--no-aplica">No aplica</span>'],
    ["sin pedir", { tipo: "importe", valor: Number.NaN, ausencia: "sin-pedir" }, '<span class="ausencia ausencia--sin-pedir">Sin pedir</span>'],
    ["un infinito tampoco es una cifra; en columna estrecha, «Falta»", { tipo: "peso", valor: Number.POSITIVE_INFINITY, estrecha: true }, '<span class="ausencia ausencia--falta">Falta</span>']
  ])("%s", (_caso, props, esperado) => {
    expect(pinta(props)).toBe(esperado);
  });

  test("un cero que está en el dato es un cero, no una ausencia", () => {
    expect(pinta({ tipo: "porcentaje", valor: 0 })).toBe(tinta(`0,00${N}%`));
  });
});
