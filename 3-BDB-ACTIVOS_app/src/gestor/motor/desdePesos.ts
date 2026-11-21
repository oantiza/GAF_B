/**
 * De una cartera de pesos a un libro de movimientos.
 *
 * Las carteras de Diseño son pesos, no movimientos. Para analizarlas y compararlas con las
 * mismas herramientas que una cartera del gestor, se convierten en el libro más simple que
 * las representa: un día se aporta un capital y se compra cada activo por su peso, al precio
 * de ese día. Después no se toca: sin reequilibrar, sin aportaciones y sin comisiones, que
 * es la misma regla con la que Diseño simula (pesos fijados el primer día).
 *
 * Así pasa por el mismo motor —misma valoración, misma rentabilidad, mismo riesgo— y sus
 * cifras se pueden poner al lado de las de una cartera real sin mezclar métodos.
 */
import { aTexto, d } from "./decimal";
import type { Dia } from "./fechas";
import type { Activo, Cartera, Movimiento } from "./modelo";

export interface PosicionPorPeso {
  activo: Activo;
  /** Peso sobre el total, en fracción: 0,25 es un 25 %. */
  peso: number;
}

export interface CarteraDePesos {
  cartera: Cartera;
  /** Activos que no se han podido comprar ese día, con su motivo. Su peso se queda en efectivo. */
  sinComprar: Array<{ activo: Activo; peso: number; motivo: string }>;
  /** Parte del capital que sí se ha invertido, de 0 a 1. */
  invertido: number;
}

export interface OpcionesDePesos {
  id: string;
  nombre: string;
  divisaBase: string;
  /** El día en que se compra: el inicio del periodo que se quiere comparar. */
  fecha: Dia;
  /** Capital que se aporta. La cifra da igual para la rentabilidad; importa para los importes. */
  capital: number;
  /** El precio de un activo ese día (el último conocido), en su divisa. */
  precio(activoId: string, fecha: Dia): number | undefined;
  /** Unidades de la divisa por 1 de la divisa base ese día. */
  cambio(divisa: string, fecha: Dia): number | undefined;
}

export function carteraDesdePesos(posiciones: readonly PosicionPorPeso[], opciones: OpcionesDePesos): CarteraDePesos {
  const { fecha, capital, divisaBase } = opciones;
  const movimientos: Movimiento[] = [{ id: "pesos-aportacion", tipo: "aportacion", fechaOperacion: fecha, importe: aTexto(d(capital.toFixed(2))), origen: { via: "manual" } }];
  const sinComprar: CarteraDePesos["sinComprar"] = [];
  const total = posiciones.reduce((suma, posicion) => suma + Math.max(0, posicion.peso), 0);
  let invertido = 0;

  for (const { activo, peso } of posiciones) {
    if (!(peso > 0)) continue;
    /* Unos pesos que suman más de 1 se reescalan; si suman menos, lo que falta se queda en efectivo. */
    const parte = total > 1 ? peso / total : peso;
    const precio = opciones.precio(activo.id, fecha);
    if (precio === undefined || !(precio > 0)) {
      sinComprar.push({ activo, peso: parte, motivo: "No tiene precio en esa fecha." });
      continue;
    }
    const cambio = activo.divisa === divisaBase ? 1 : opciones.cambio(activo.divisa, fecha);
    if (cambio === undefined || !(cambio > 0)) {
      sinComprar.push({ activo, peso: parte, motivo: `No hay tipo de cambio de ${activo.divisa} en esa fecha.` });
      continue;
    }
    const multiplicador = activo.multiplicador ? Number(activo.multiplicador) : 1;
    const importe = capital * parte;
    const titulos = (importe * cambio) / (precio * multiplicador);
    const movimiento: Movimiento = {
      id: `pesos-${activo.id}`,
      tipo: activo.tipo === "FONDO" ? "suscripcion" : "compra",
      fechaOperacion: fecha,
      activoId: activo.id,
      titulos: aTexto(d(titulos.toFixed(8))),
      precio: aTexto(d(String(precio))),
      importe: aTexto(d((-importe).toFixed(2))),
      origen: { via: "manual" }
    };
    if (activo.divisa !== divisaBase) movimiento.cambio = aTexto(d(cambio.toFixed(8)));
    movimientos.push(movimiento);
    invertido += parte;
  }

  return {
    cartera: {
      id: opciones.id,
      nombre: opciones.nombre,
      divisaBase,
      creada: `${fecha}T00:00:00.000Z`,
      modificada: `${fecha}T00:00:00.000Z`,
      cuentas: { efectivo: { nombre: "Cuenta de efectivo" }, valores: { nombre: "Cuenta de valores" } },
      activos: posiciones.filter((posicion) => posicion.peso > 0).map((posicion) => posicion.activo),
      movimientos,
      preciosManuales: [],
      extractos: [],
      importaciones: [],
      extensiones: { dePesos: true }
    },
    sinComprar,
    invertido
  };
}
