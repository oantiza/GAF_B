/**
 * Un doble de la Web Locks API (`navigator.locks`) para las pruebas del almacén: cerrojos
 * exclusivos por nombre, concedidos por orden de petición, y compartidos por todos los almacenes
 * que reciban el mismo doble, como lo son entre las pestañas de un navegador.
 *
 * Como el real: la tarea corre con el cerrojo cogido, el cerrojo se suelta cuando su promesa
 * termina (bien o mal), y `request` devuelve lo que devuelva la tarea o falla con su error.
 */
import type { GestorDeCerrojos } from "../../src/gestor/almacen/carpeta";

export interface CerrojosFalsos {
  cerrojos: GestorDeCerrojos;
  /** Los nombres pedidos, en orden. */
  pedidos: string[];
}

export function crearCerrojosFalsos(): CerrojosFalsos {
  const colas = new Map<string, Promise<unknown>>();
  const pedidos: string[] = [];
  return {
    pedidos,
    cerrojos: {
      request(nombre, tarea) {
        pedidos.push(nombre);
        const resultado = (colas.get(nombre) ?? Promise.resolve()).then(() => tarea());
        colas.set(nombre, resultado.catch(() => undefined));
        return resultado;
      }
    }
  };
}
