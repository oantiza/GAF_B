/**
 * Ayudas para las pruebas del gestor de carteras: construir carteras pequeñas con pocas
 * palabras. Las cifras esperadas de cada prueba salen de una cuenta a mano escrita junto a
 * ella, nunca de la salida del motor.
 */
import { rangoDeDias } from "../../src/gestor/motor/fechas";
import { carteraVacia, type Activo, type Cartera, type Movimiento, type TipoDeActivo } from "../../src/gestor/motor/modelo";

export function activo(id: string, tipo: TipoDeActivo = "ACCION", divisa = "EUR", extra: Partial<Activo> = {}): Activo {
  return { id, nombre: `Activo ${id}`, tipo, divisa, origen: "manual", ...extra };
}

let contador = 0;

/** Un movimiento: tipo, fecha de operación y el resto de campos. El id es correlativo y legible. */
export function mov(tipo: string, fechaOperacion: string, campos: Partial<Movimiento> = {}): Movimiento {
  contador += 1;
  return { id: campos.id ?? `m${contador}`, tipo, fechaOperacion, ...campos };
}

export function cartera(activos: Activo[], movimientos: Movimiento[], extra: Partial<Cartera> = {}): Cartera {
  return {
    ...carteraVacia({ nombre: "Cartera de prueba", ahora: "2026-01-01T00:00:00.000Z", id: "cartera-de-prueba" }),
    activos,
    movimientos,
    ...extra
  };
}

/** Una serie de precios a partir de pares [día, precio]. */
export function serie(...puntos: Array<[string, number]>): Array<{ fecha: string; valor: number }> {
  return puntos.map(([fecha, valor]) => ({ fecha, valor }));
}

/**
 * Una serie con un dato CADA DÍA natural entre dos fechas, las dos incluidas: vale `inicial` todos los días menos el
 * último, que vale `final`. Es un índice sin huecos con una rentabilidad que se calcula de cabeza: final / inicial − 1.
 */
export function serieDiaria(desde: string, hasta: string, inicial: number, final: number): Array<{ fecha: string; valor: number }> {
  const dias = rangoDeDias(desde, hasta);
  return dias.map((fecha, i) => ({ fecha, valor: i === dias.length - 1 ? final : inicial }));
}
