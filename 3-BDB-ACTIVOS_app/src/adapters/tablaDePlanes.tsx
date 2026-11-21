/**
 * Las columnas de la lista de planes de pensiones y EPSV.
 *
 * La lista sirve para encontrar un plan, no para elegirlo: lleva lo justo para reconocerlo —qué es, de quién, en
 * qué categoría— y las cifras por las que se suele ordenar. El resto está en su ficha. Todas las cifras son del
 * proveedor y de la misma clase —no hay métodos mezclados—, así que la tabla ordena sin agrupar.
 *
 * La columna «Producto» es la que no puede faltar: dice si es un plan de pensiones o una EPSV, que no tributan
 * igual. Va con su `Distintivo`, una palabra y no un color.
 *
 * Las rentabilidades son resultados: llevan su signo escrito y el color del signo (`Cifra`). La volatilidad, el
 * Sharpe y la comisión, no. Lo que falta se dice con su ausencia, como antes: no se pinta de verde un hueco.
 */
import type { MouseEvent } from "react";
import { InsigniaDeProducto } from "../components/planes/InsigniaDeProducto";
import { Button } from "../components/ui/Button";
import { Cifra } from "../components/ui/Cifra";
import { celdaDeComision, celdaDeEstrellas, celdaDeRentabilidad, celdaDeSharpe, celdaDeVolatilidad } from "../core/planes/lectura";
import { direccionDeLaVista, MAXIMO_A_COMPARAR, nombreDelTipo, type PlanDePensiones, type VentanaDeRentabilidad } from "../core/planes/modelo";
import { textoDeAusencia } from "../core/textoDeAusencia";
import * as formato from "../core/formato";
import type { CeldaDeTabla, ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";

export interface FilaDePlan extends FilaAgrupable {
  plan: PlanDePensiones;
}

/**
 * La rentabilidad de la lista, con su signo y su color. El texto y lo que ordena son los de siempre —la cifra del
 * proveedor—; solo cambia cómo se pinta. Sin cifra, la ausencia de `lectura`, intacta.
 */
export function celdaDeRentabilidadConSigno(plan: PlanDePensiones, ventana: VentanaDeRentabilidad, estrecha = false): CeldaDeTabla {
  const celda = celdaDeRentabilidad(plan, ventana, estrecha);
  if (typeof celda.valor !== "number") return celda;
  return { ...celda, texto: formato.rentabilidad(celda.valor) ?? celda.texto, nodo: <Cifra tipo="rentabilidad" valor={celda.valor} /> };
}

export function filasDePlanes(planes: readonly PlanDePensiones[]): FilaDePlan[] {
  return planes.map((plan) => ({ id: plan.id, plan }));
}

export interface OpcionesDeLaLista {
  /** Los planes marcados para comparar. */
  marcados: readonly string[];
  alMarcar: (id: string) => void;
  alAbrir: (id: string) => void;
  /** Fuera de Modo cliente se nombra de quién es el dato. */
  conProveedor: boolean;
}

export function columnasDePlanes({ marcados, alMarcar, alAbrir, conProveedor }: OpcionesDeLaLista): ColumnaDeTabla<FilaDePlan>[] {
  const abrir = (id: string) => (evento: MouseEvent<HTMLAnchorElement>) => {
    evento.stopPropagation();
    /* Otra pestaña, otra ventana o copiar la dirección lo resuelve el navegador: el enlace es de verdad. */
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    alAbrir(id);
  };

  return [
    {
      id: "nombre",
      titulo: "Plan",
      encabezaFila: true,
      celda: ({ plan }) => ({
        texto: plan.nombre,
        valor: plan.nombre,
        nodo: (
          <>
            <a className="enlace-a-ficha" href={direccionDeLaVista({ tipo: "ficha", id: plan.id })} onClick={abrir(plan.id)}>
              {plan.nombre}
            </a>
            {plan.gestora ? <span className="tabla__apunte">{plan.gestora}</span> : null}
            {plan.categoria ? <span className="tabla__apunte tabla__apunte--estrecho">{plan.categoria}</span> : null}
          </>
        )
      })
    },
    {
      id: "producto",
      titulo: "Producto",
      celda: ({ plan }) => ({
        texto: nombreDelTipo(plan.tipo),
        valor: `${nombreDelTipo(plan.tipo)}${plan.empleoSimplificado ? " de empleo simplificado" : ""}`,
        nodo: (
          <>
            <InsigniaDeProducto plan={plan} />
            {plan.empleoSimplificado ? <span className="tabla__apunte">De empleo simplificado</span> : null}
          </>
        )
      })
    },
    {
      id: "categoria",
      titulo: "Categoría",
      soloAncho: true,
      /* PLA-18: el texto de lo que falta, del sitio común, no escrito a mano. */
      celda: ({ plan }) => (plan.categoria ? { texto: plan.categoria } : { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" })
    },
    { id: "estrellas", titulo: conProveedor ? "Morningstar" : "Estrellas", tituloCompleto: conProveedor ? "Estrellas Morningstar" : undefined, cifra: true, celda: ({ plan }) => celdaDeEstrellas(plan, true) },
    /* PLA-18 daba los nombres de la ficha enteros; desde el 17-11-2026 la cabecera va corta (Óscar) y el nombre entero sale al pasar el ratón. */
    { id: "ytd", titulo: "YTD", tituloCompleto: "En lo que va de año", cifra: true, celda: ({ plan }) => celdaDeRentabilidadConSigno(plan, "ytd", true) },
    { id: "a1", titulo: "1A", tituloCompleto: "1 año", cifra: true, celda: ({ plan }) => celdaDeRentabilidadConSigno(plan, "1y", true) },
    { id: "a3", titulo: "3A anual.", tituloCompleto: "3 años, anualizada", cifra: true, celda: ({ plan }) => celdaDeRentabilidadConSigno(plan, "3y", true) },
    { id: "a5", titulo: "5A anual.", tituloCompleto: "5 años, anualizada", cifra: true, celda: ({ plan }) => celdaDeRentabilidadConSigno(plan, "5y", true) },
    { id: "volatilidad", titulo: "Vol. 3A", tituloCompleto: "Volatilidad 3 años", cifra: true, celda: ({ plan }) => celdaDeVolatilidad(plan, "3y", true) },
    { id: "sharpe", titulo: "Sharpe 3A", tituloCompleto: "Sharpe 3 años", cifra: true, soloAncho: true, celda: ({ plan }) => celdaDeSharpe(plan, true) },
    { id: "comision", titulo: "Comisión", tituloCompleto: "Comisión de gestión", cifra: true, celda: ({ plan }) => celdaDeComision(plan, true) },
    {
      id: "comparar",
      titulo: "Comparar",
      tituloOculto: true,
      acciones: true,
      celda: ({ plan }) => {
        const marcado = marcados.includes(plan.id);
        return {
          texto: "",
          nodo: (
            <Button
              aria-label={marcado ? `Quitar ${plan.nombre} de la comparación` : `Comparar ${plan.nombre}`}
              aria-pressed={marcado}
              disabled={!marcado && marcados.length >= MAXIMO_A_COMPARAR}
              onClick={() => alMarcar(plan.id)}
              /* Desactivado, dice por qué (PLA-24). */
              title={!marcado && marcados.length >= MAXIMO_A_COMPARAR ? `Ya hay ${MAXIMO_A_COMPARAR} planes para comparar: quita uno para añadir otro.` : undefined}
              size="sm"
              variant="secondary"
            >
              {marcado ? "Quitar" : "Comparar"}
            </Button>
          )
        };
      }
    }
  ];
}
