/**
 * Las ventanas, en palabras, al imprimir: en papel no se escribe «1A», «3A» ni «Vol 3A» (revisión de la migración a la
 * plantilla, 14-11-2026), sino «1 año», «3 años», «volatilidad 3 años». Algunos rótulos llegan ya escritos de fuera
 * (`comparativaDeActivos.ts`: el pie de método «Sharpe 3A calculado…» y los rótulos de `CifrasDelProveedorEnElPapel`; la pantalla:
 * «Máx. caída 3A»), y se cambian aquí, al imprimirlos, sin tocar a quien los escribe.
 *
 * Solo cambia una cifra suelta seguida de «A» (con límite de palabra a los dos lados): un ISIN o un código no se tocan.
 */
const anos = (n: string) => `${n} ${n === "1" ? "año" : "años"}`;

export function ventanasEnPalabras(texto: string): string {
  return texto
    .replace(/\bSharpe (\d+)A calculado/g, (_, n: string) => `Sharpe a ${anos(n)} calculado`)
    .replace(/^Máx\.\s*caída/i, "Caída máxima")
    .replace(/\bVol (\d+)A\b/g, (_, n: string) => `volatilidad ${anos(n)}`)
    .replace(/\b(\d+)A\b/g, (_, n: string) => anos(n));
}
