import { numero } from "./formato";

/**
 * Dónde queda la composición simulada respecto a la línea de carteras de referencia del mapa, y cómo se dice (decisiones 4 y 66).
 *
 * La frase describe y no juzga: no dice que la cartera «obtenga más de lo que le correspondería», dice cuántos puntos
 * hay entre ella y la línea en este periodo. El cálculo es el de siempre: la línea une los perfiles ordenados por
 * oscilación y se interpola entre los dos que la rodean; a menos de medio punto, se considera en línea.
 */

export interface PuntoDelMapa {
  vol: number;
  ret: number;
}

export interface PerfilDelMapa extends PuntoDelMapa {
  label: string;
}

/** Medio punto de rentabilidad: por debajo de esto, no se dice que quede por encima ni por debajo. */
const MARGEN_EN_LINEA = 0.005;

function porOscilacion<T extends PuntoDelMapa>(perfiles: readonly T[]): T[] {
  return [...perfiles].sort((a, b) => a.vol - b.vol);
}

/** La rentabilidad de la línea a ese nivel de oscilación. Fuera de la línea, la del perfil más cercano. Null sin perfiles. */
export function rentabilidadDeLaLinea(vol: number, perfiles: readonly PuntoDelMapa[]): number | null {
  if (perfiles.length === 0) return null;
  const orden = porOscilacion(perfiles);
  const inferior = [...orden].reverse().find((perfil) => perfil.vol <= vol) ?? orden[0];
  const superior = orden.find((perfil) => perfil.vol >= vol) ?? orden[orden.length - 1];
  return superior.vol === inferior.vol
    ? inferior.ret
    : inferior.ret + ((vol - inferior.vol) / (superior.vol - inferior.vol)) * (superior.ret - inferior.ret);
}

export interface LecturaDelMapa {
  posicion: "encima" | "en_linea" | "debajo";
  /** Distancia a la línea, en puntos de rentabilidad y sin signo. */
  puntos: number;
  /** Si la composición oscila menos o más que todos los perfiles, la línea no llega a su nivel: se compara con el último. */
  fueraDeLaLinea: { lado: "menos" | "mas"; perfil: string } | null;
}

export function lecturaDelMapa(cartera: PuntoDelMapa, perfiles: readonly PerfilDelMapa[]): LecturaDelMapa | null {
  const linea = rentabilidadDeLaLinea(cartera.vol, perfiles);
  if (linea === null) return null;
  const orden = porOscilacion(perfiles);
  const primero = orden[0];
  const ultimo = orden[orden.length - 1];
  const diferencia = cartera.ret - linea;
  return {
    posicion: diferencia > MARGEN_EN_LINEA ? "encima" : diferencia < -MARGEN_EN_LINEA ? "debajo" : "en_linea",
    puntos: Math.abs(diferencia) * 100,
    fueraDeLaLinea: cartera.vol < primero.vol
      ? { lado: "menos", perfil: primero.label }
      : cartera.vol > ultimo.vol
        ? { lado: "mas", perfil: ultimo.label }
        : null
  };
}

const VENTAJA = "Es una medida del pasado, no una ventaja asegurada.";
const SIN_VENTAJA = "Es una medida del pasado, no anticipa el futuro.";

/**
 * La frase del mapa, con los puntos del dato. Es una diferencia entre dos rentabilidades: dos decimales y «pp»; sin
 * signo, porque el lado lo dice la frase («por encima», «por debajo»).
 */
export function fraseDelMapa(lectura: LecturaDelMapa): string {
  const puntos = `${numero(lectura.puntos, { decimales: 2 })}\u00a0pp`;
  const cierre = lectura.posicion === "encima" ? VENTAJA : SIN_VENTAJA;
  if (lectura.fueraDeLaLinea) {
    const { lado, perfil } = lectura.fueraDeLaLinea;
    const oscila = lado === "mas" ? "oscila más que todas las carteras de referencia" : "oscila menos que todas las carteras de referencia";
    const extremo = `${perfil}, la cartera de referencia que ${lado === "mas" ? "más" : "menos"} oscila`;
    const respecto = lectura.posicion === "en_linea"
      ? `queda en línea con ${extremo}`
      : `queda ${puntos} por ${lectura.posicion === "encima" ? "encima" : "debajo"} de ${extremo}`;
    return `En este periodo, la composición simulada ${oscila}, así que la línea no llega a su nivel: ${respecto}. ${cierre}`;
  }
  if (lectura.posicion === "en_linea") {
    return `En este periodo, la composición simulada queda en línea con las carteras de referencia para su nivel de oscilación. ${cierre}`;
  }
  return `En este periodo, la composición simulada queda ${puntos} por ${lectura.posicion === "encima" ? "encima" : "debajo"} de la línea de carteras de referencia para su nivel de oscilación. ${cierre}`;
}
