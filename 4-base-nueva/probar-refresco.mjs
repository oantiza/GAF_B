/**
 * 4-base-nueva/probar-refresco.mjs — el listado de quién entra en el cálculo (decisión 91), con cambios simulados.
 *
 *   node 4-base-nueva/probar-refresco.mjs
 *
 * No toca la base, ni la lista guardada, ni la red: son las funciones puras de `refrescar.mjs` con listas escritas a mano,
 * y la orden `--solo-listado` se prueba aparte, contra el emulador, porque esa sí lee.
 */
import assert from 'node:assert/strict';

import { cambiosEnElCalculo, hayQuePararLaSubida, sinReescribir, sonDemasiados, textoDeLosNoReescritos, textoDelListado } from './refrescar.mjs';

const BNY = { isin: 'IE00BD5CTX77', nombre: 'BNY H Acc', entra: true, rendimiento_12m_pct: 4.97, diferencias_pp: { '3y': 0, '5y': -0.0004, '10y': null } };
const DWS = { isin: 'LU1740985814', nombre: 'DWS Strategic Dynamic LD', entra: false, rendimiento_12m_pct: 0.03, diferencias_pp: { '3y': -0.037, '5y': -0.407, '10y': null } };
const TAIWAN = { isin: 'LU0117843481', nombre: 'JPMorgan Taiwan', entra: false, rendimiento_12m_pct: 0.06, diferencias_pp: {} };
const listado = (fondos) => ({ con_rendimiento: 14, bloqueados: 9, fondos });
const anterior = (...entran) => ({ fecha: '2026-11-05', entran: entran.map(({ isin, nombre }) => ({ isin, nombre })) });
const texto = (fondos, previo) => textoDelListado(listado(fondos), previo, cambiosEnElCalculo(previo, fondos));

let n = 0;
function caso(nombre, comprueba) {
  comprueba();
  n += 1;
  console.log(`  ok  ${nombre}`);
}

caso('la primera vez no hay nada que comparar, y no para la subida', () => {
  const cambios = cambiosEnElCalculo(undefined, [BNY, DWS]);
  assert.deepEqual(cambios, { primera: true, entran: [], salen: [] });
  assert.equal(hayQuePararLaSubida(cambios, { sube: true, admite: false }), false);
  assert.match(texto([BNY, DWS], undefined), /No hay subida anterior con la que comparar/);
});

caso('si no cambia nadie, lo dice y no para', () => {
  const previo = anterior(BNY);
  const cambios = cambiosEnElCalculo(previo, [BNY, DWS]);
  assert.deepEqual(cambios, { primera: false, entran: [], salen: [] });
  assert.equal(hayQuePararLaSubida(cambios, { sube: true, admite: false }), false);
  assert.match(texto([BNY, DWS], previo), /Respecto a la última subida, del 2026-11-05: nadie entra ni sale/);
});

caso('DWS entra: se nombra, y --sube se para hasta que se admita', () => {
  const previo = anterior(BNY);
  const hoy = [BNY, { ...DWS, entra: true }];
  const cambios = cambiosEnElCalculo(previo, hoy);
  assert.deepEqual(cambios.entran.map((f) => f.isin), [DWS.isin]);
  assert.deepEqual(cambios.salen, []);
  assert.equal(hayQuePararLaSubida(cambios, { sube: true, admite: false }), true);
  assert.equal(hayQuePararLaSubida(cambios, { sube: true, admite: true }), false);
  assert.equal(hayQuePararLaSubida(cambios, { sube: false, admite: false }), false);
  const dicho = texto(hoy, previo);
  assert.match(dicho, /ENTRA EN EL CÁLCULO {2}LU1740985814 {2}DWS Strategic Dynamic LD/);
  assert.match(dicho, /míralas antes de subir/);
});

caso('BNY sale: se nombra aunque ya no esté en la lista de hoy', () => {
  const previo = anterior(BNY);
  const hoy = [{ ...BNY, entra: false }, DWS];
  const cambios = cambiosEnElCalculo(previo, hoy);
  assert.deepEqual(cambios.salen.map((f) => f.isin), [BNY.isin]);
  assert.equal(hayQuePararLaSubida(cambios, { sube: true, admite: false }), true);
  assert.match(texto(hoy, previo), /SALE DEL CÁLCULO {4}IE00BD5CTX77 {2}BNY H Acc/);
  const fondoQueDesaparece = cambiosEnElCalculo(previo, [DWS]);
  assert.deepEqual(fondoQueDesaparece.salen.map((f) => f.isin), [BNY.isin]);
});

caso('uno entra y otro sale a la vez', () => {
  const previo = anterior(BNY);
  const cambios = cambiosEnElCalculo(previo, [{ ...BNY, entra: false }, { ...DWS, entra: true }]);
  assert.deepEqual([cambios.entran.map((f) => f.isin), cambios.salen.map((f) => f.isin)], [[DWS.isin], [BNY.isin]]);
});

caso('cada fondo dice lo que le separa del proveedor, en positivo y con coma; sin contraste lo dice', () => {
  const dicho = texto([BNY, DWS, TAIWAN], anterior(BNY));
  assert.match(dicho, /ENTRA {2}IE00BD5CTX77 {2}BNY H Acc \| 3 años 0,000 · 5 años 0,000/);
  assert.match(dicho, /fuera {2}LU1740985814 {2}DWS Strategic Dynamic LD \| 3 años 0,037 · 5 años 0,407/);
  assert.match(dicho, /fuera {2}LU0117843481 {2}JPMorgan Taiwan \| sin contraste/);
  assert.match(dicho, /14 fondos\. 9 los bloquea su política/);
});

/* Auditoría del 16-11-2026, PLA-1: el escritor no borra, así que lo que dice si la fuente ha fallado es quién NO se ha
   vuelto a escribir. La pasada empieza a las 10:00:00 del 16-11-2026. */
const INICIO = '2026-11-16T10:00:00.000Z';
const raiz = (id, escrito) => ({ id, nombre: `Fondo ${id}`, escrito });

caso('una raíz escrita después de empezar la pasada está al día; la de una pasada anterior, no', () => {
  const raices = [raiz('A', '2026-11-16T10:00:05.123Z'), raiz('B', '2026-11-09T08:30:00.000Z'), raiz('C', INICIO)];
  assert.deepEqual(sinReescribir(raices, INICIO).map((r) => r.id), ['B']);
});

caso('una raíz sin fecha, o con una que no se lee, cuenta como no escrita', () => {
  assert.deepEqual(sinReescribir([raiz('A', undefined), raiz('B', 'ayer')], INICIO).map((r) => r.id), ['A', 'B']);
});

caso('el corte es el 1 % que ya se admitía perder: de 1.104, 11 pasan y 12 paran', () => {
  /* 1.104 × 0,01 = 11,04. */
  assert.equal(sonDemasiados(11, 1104), false);
  assert.equal(sonDemasiados(12, 1104), true);
  assert.equal(sonDemasiados(0, 1104), false);
});

caso('se nombran con su fecha, y a partir de quince se cuentan', () => {
  assert.equal(textoDeLosNoReescritos([], 1104), '');
  const dicho = textoDeLosNoReescritos([raiz('LU0117843481', '2026-11-09T08:30:00.000Z'), raiz('IE00BD5CTX77', undefined)], 1104);
  assert.match(dicho, /AVISO: 2 de 1104 instrumentos no se han vuelto a escribir en esta pasada/);
  assert.match(dicho, /subiría como vigente/);
  assert.match(dicho, /LU0117843481 {2}Fondo LU0117843481 \| escrito el 2026-11-09/);
  assert.match(dicho, /IE00BD5CTX77 {2}Fondo IE00BD5CTX77 \| escrito el sin fecha/);
  const muchos = Array.from({ length: 20 }, (_, i) => raiz(`X${i}`, '2026-11-09T08:30:00.000Z'));
  assert.match(textoDeLosNoReescritos(muchos, 1104), /\.\.\. y 5 más/);
});

console.log(`\n${n} casos, todos bien. Nada escrito.`);
