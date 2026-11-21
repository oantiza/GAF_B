/**
 * La presentación de los documentos para el cliente: de qué periodo es y de cuándo son los datos, la cartera como título, la
 * frase que presenta el documento y, en una rejilla corta, para quién es, quién lo elabora, cuándo se ha hecho y en qué divisa
 * van los importes. Sin marca de ninguna entidad. La misma presentación sirve al informe del cliente, que abre además con las
 * cifras que responden, y al de costes (`crearPresentacion`).
 *
 * Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) el informe de cartera abre con la
 * portada a página completa del papel de cliente (`Portada` de la plantilla), con la cartera como título muy grande, para quién
 * es debajo y «Elaborado por» con quien firma. Desde el 16-11-2026, sin cifras ni frase de presentación: solo el nombre. El de
 * costes sigue abriendo con el título grande en su primera hoja.
 */
import type { ReactElement } from "react";
import { fechaLarga } from "../../../../core/formato";
import { Portada, Presentacion, type DatoDeRejilla } from "../../../../reports/plantilla";
import { periodoEnPalabras } from "../../formato";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { firmaDe, identidadDe } from "../comun";

function datosDeLaPresentacion(datos: DatosDelInforme): DatoDeRejilla[] {
  const { analisis } = datos;
  const cliente = analisis.cartera.cliente?.trim();
  const firma = firmaDe(datos);
  const contacto = identidadDe(datos).contacto?.trim();
  const divisa = analisis.cartera.divisaBase;
  return [
    ...(cliente ? [{ rotulo: "Preparado para", valor: cliente }] : []),
    ...(firma ? [{ rotulo: "Elaborado por", valor: contacto ? `${firma} · ${contacto}` : firma }] : []),
    { rotulo: "Fecha del informe", valor: fechaLarga(datos.generado) },
    { rotulo: "Importes en", valor: divisa === "EUR" ? "euros" : divisa }
  ];
}

/**
 * Una presentación para un documento del cliente: la frase que lo presenta y, si las tiene, las cifras que responden. Con
 * `portada`, es la portada a página completa: «Preparado para» va como destinatario bajo el título y «Elaborado por» lo pone
 * la portada con la identidad del asesor; la rejilla lleva el resto.
 */
export function crearPresentacion({ presentacion, Cifras, portada = false }: { presentacion?: string; Cifras?: (props: { datos: DatosDelInforme }) => ReactElement | null; portada?: boolean }): SeccionDeInforme {
  if (portada) {
    return {
      id: "presentacion",
      titulo: "Presentación",
      comienzo: "portada",
      procede: () => true,
      Contenido: ({ datos }) => (
        <Portada
          antetitulo={`${periodoEnPalabras(datos.analisis)} · datos a ${fechaLarga(datos.analisis.fecha) ?? datos.analisis.fecha}`}
          antetituloComoViene
          titulo={datos.analisis.cartera.nombre}
          destinatario={datos.analisis.cartera.cliente?.trim() || undefined}
          entradilla={presentacion}
          datos={datosDeLaPresentacion(datos).filter((dato) => dato.rotulo !== "Preparado para" && dato.rotulo !== "Elaborado por")}
        >
          {Cifras ? <Cifras datos={datos} /> : null}
        </Portada>
      )
    };
  }
  return {
    id: "presentacion",
    titulo: "Presentación",
    comienzo: "presentacion",
    procede: () => true,
    Contenido: ({ datos }) => (
      <>
        <Presentacion
          contexto={[periodoEnPalabras(datos.analisis), `datos a ${fechaLarga(datos.analisis.fecha) ?? datos.analisis.fecha}`]}
          titulo={datos.analisis.cartera.nombre}
          entradilla={presentacion}
          datos={datosDeLaPresentacion(datos)}
        />
        {Cifras ? <Cifras datos={datos} /> : null}
      </>
    )
  };
}

/**
 * La portada del informe de cartera: el nombre de la cartera, para quién es, de qué periodo y quién lo elabora. Nada más (Óscar,
 * 16-11-2026: «en la primera página solo el nombre»): las cifras abren «Cómo ha ido su cartera», detrás de la cartera, y la frase
 * que presentaba el documento se quitó, porque cada sección dice ya qué cuenta.
 */
export const presentacion = crearPresentacion({ portada: true });
