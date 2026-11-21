/**
 * Ayudas de las pruebas de los informes: la demostración analizada en dos periodos, una
 * cartera sencilla sin referencia, bonos, ventas ni avisos, una cartera vacía, un logotipo PNG
 * hecho aquí mismo y la lectura del texto de un PDF generado.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { analizar, periodosHabituales, preparar, type IdDePeriodo } from "../../src/gestor/motor/analisis";
import { sumarDias } from "../../src/gestor/motor/fechas";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import type { Punto } from "../../src/gestor/motor/valoracion";
import { extractPdfPageTexts } from "../support/pdfText";
import { activo, cartera, mov } from "./ayudas";

export const HOY = "2026-11-13";

export const SALIDA = fileURLToPath(new URL("../../output/gestor/", import.meta.url));

/** Los datos de un informe de la demostración para un periodo habitual. */
export function datosDeLaDemo(periodo: IdDePeriodo, asesor?: DatosDelInforme["asesor"]): DatosDelInforme {
  const demo = demostracion(HOY);
  const preparado = preparar(demo.cartera, demo.mercado, demo.fichas, HOY);
  const elegido = periodosHabituales(preparado.valoracion, HOY).find((p) => p.id === periodo)!;
  return { analisis: analizar(preparado, elegido.periodo, demo.referencia), cartera: demo.cartera, asesor, generado: HOY };
}

/**
 * Cinco fondos en euros con precio todos los días, comprados a partes iguales: sin índice de
 * referencia, sin bonos, sin ventas, sin precios viejos y sin ninguna posición por encima del
 * 25 % (que daría una nota de concentración). No hay extractos que conciliar.
 */
export function datosSencillos(): DatosDelInforme {
  const desde = "2026-01-02";
  const dias: string[] = [];
  for (let dia = sumarDias(desde, -5); dia <= HOY; dia = sumarDias(dia, 1)) dias.push(dia);
  const activos = ["F1", "F2", "F3", "F4", "F5"].map((id) => activo(id, "FONDO", "EUR", { nombre: `Fondo ${id} de prueba` }));
  const precios = new Map<string, Punto[]>(activos.map((a, i) => [a.id, dias.map((fecha, k) => ({ fecha, valor: 100 + i + k * 0.01 * (i + 1) }))]));
  const movimientos = [
    mov("aportacion", desde, { importe: "100000" }),
    ...activos.map((a) => mov("suscripcion", desde, { activoId: a.id, titulos: "180", precio: String(precios.get(a.id)!.find((p) => p.fecha === desde)!.valor), importe: `-${(180 * precios.get(a.id)!.find((p) => p.fecha === desde)!.valor).toFixed(2)}` }))
  ];
  const c = cartera(activos, movimientos, { nombre: "Cartera sencilla" });
  const preparado = preparar(c, { precios, cambios: new Map() }, new Map(), HOY);
  return { analisis: analizar(preparado, { desde: "2025-12-31", hasta: HOY }), cartera: c, generado: HOY };
}

/** Una cartera sin ningún movimiento. */
export function datosVacios(): DatosDelInforme {
  const c = carteraVacia({ nombre: "Cartera vacía", ahora: "2026-01-01T00:00:00.000Z", id: "vacia" });
  const preparado = preparar(c, { precios: new Map(), cambios: new Map() }, new Map(), HOY);
  return { analisis: analizar(preparado, { desde: "2025-12-31", hasta: HOY }), cartera: c, generado: HOY };
}

/* ---------------------------------------------------------------- un PNG de verdad */

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** Un logotipo de prueba: un rectángulo de 120 × 40 píxeles, granate con una banda bronce, como data URL PNG. */
export function logotipoDePrueba(): string {
  const ancho = 120;
  const alto = 40;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  const filas: Buffer[] = [];
  for (let y = 0; y < alto; y += 1) {
    const fila = Buffer.alloc(1 + ancho * 3);
    for (let x = 0; x < ancho; x += 1) {
      const banda = y > 28 && y < 34;
      fila[1 + x * 3] = banda ? 0x9c : 0xa8;
      fila[2 + x * 3] = banda ? 0x84 : 0x1e;
      fila[3 + x * 3] = banda ? 0x59 : 0x33;
    }
    filas.push(fila);
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", zlib.deflateSync(Buffer.concat(filas))), trozo("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/* ---------------------------------------------------------------- leer lo impreso */

/** El espacio duro como espacio corriente, para comparar con lo que se lee del papel. */
export const plano = (texto: string) => texto.replaceAll(String.fromCharCode(0xa0), " ");

/** Guarda el PDF en `output/gestor/` y devuelve el texto de cada página. */
export async function paginasDe(blob: Blob, nombre: string): Promise<{ bytes: Buffer; paginas: string[] }> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  mkdirSync(SALIDA, { recursive: true });
  writeFileSync(`${SALIDA}${nombre}.pdf`, bytes);
  return { bytes, paginas: extractPdfPageTexts(bytes).map(plano) };
}
