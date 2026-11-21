/**
 * Un logotipo inventado para la muestra: las iniciales «RA» en un cuadro de contorno, como el de la maqueta, en PNG y en
 * *data URL*. Se dibuja aquí, sin dependencias: una rejilla de 5 × 7 por letra, ampliada, y un PNG mínimo con zlib.
 */
import { deflateSync } from "node:zlib";

const LADO = 120;
const BORDE = 5;
const ESCALA = 6;
const TINTA = [0x1a, 0x1a, 0x18];

const LETRAS: Record<string, string[]> = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"]
};

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

/** El logotipo, como PNG en *data URL*. */
export function logotipoDeMuestra(): string {
  const tinta = (x: number, y: number): boolean => {
    if (x < BORDE || y < BORDE || x >= LADO - BORDE || y >= LADO - BORDE) return true;
    const iniciales = "RA";
    const anchoDeLetra = 5 * ESCALA;
    const total = iniciales.length * anchoDeLetra + ESCALA;
    const x0 = Math.floor((LADO - total) / 2);
    const y0 = Math.floor((LADO - 7 * ESCALA) / 2);
    for (let l = 0; l < iniciales.length; l += 1) {
      const lx = x0 + l * (anchoDeLetra + ESCALA);
      if (x < lx || x >= lx + anchoDeLetra || y < y0 || y >= y0 + 7 * ESCALA) continue;
      return LETRAS[iniciales[l]][Math.floor((y - y0) / ESCALA)][Math.floor((x - lx) / ESCALA)] === "1";
    }
    return false;
  };
  const filas: Buffer[] = [];
  for (let y = 0; y < LADO; y += 1) {
    const fila = Buffer.alloc(1 + LADO * 3);
    for (let x = 0; x < LADO; x += 1) {
      const color = tinta(x, y) ? TINTA : [0xff, 0xff, 0xff];
      fila.set(color, 1 + x * 3);
    }
    filas.push(fila);
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(LADO, 0);
  cabecera.writeUInt32BE(LADO, 4);
  cabecera.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
