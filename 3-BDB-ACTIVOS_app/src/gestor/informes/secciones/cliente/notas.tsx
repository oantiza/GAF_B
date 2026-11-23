/* eslint-disable react-refresh/only-export-components */
/**
 * «Notas»: qué es cada cifra, en una línea, y los avisos que tocan. El
 * glosario sale de las ayudas del registro de métricas; el Sharpe no está, porque no va en este informe.
 */
import { fechaLarga } from "../../../../core/formato";
import { Tabla } from "../../../../reports/plantilla";
import { esDemostracion } from "../../../demo/carteraDemo";
import type { Analisis } from "../../../motor/analisis";
import { metrica } from "../../../motor/metricas/registro";
import { FUENTE } from "../../../motor/valoracion";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { sinCortarLaUnidad, Subtitulo, Vinetas } from "../piezas";

/** Las cifras del informe del cliente, con el nombre que llevan en él. */
const GLOSARIO: Array<{ id: string; nombre?: string }> = [
  { id: "patrimonio" },
  { id: "resultado", nombre: "Ganado o perdido" },
  { id: "aportacionesNetas", nombre: "Aportado neto" },
  { id: "rentabilidad", nombre: "Rentabilidad de la cartera" },
  { id: "rentabilidadAnualizada", nombre: "Rentabilidad anualizada" },
  { id: "rentabilidadDelCliente", nombre: "Rentabilidad de su dinero" },
  { id: "ingresos" },
  /* Los costes no van en este informe: tienen el suyo, el informe de costes. */
  { id: "volatilidad" },
  { id: "maximaCaida", nombre: "Caída máxima" },
  { id: "diferenciaConLaReferencia", nombre: "Frente a la referencia" }
];

/**
 * De dónde salen los precios con los que se valora la cartera (INF-11). Solo dice «de mercado» de
 * todos si todos lo son; si no, nombra cada posición que no lo es: a mano, del extracto del banco,
 * de su última operación o sin precio.
 */
export function notaDeLosPrecios(analisis: Pick<Analisis, "posiciones">): string {
  const de = (fuente: number) => analisis.posiciones.filter((posicion) => posicion.fuente === fuente).map((posicion) => posicion.activo.nombre);
  const aMano = de(FUENTE.manual);
  const delExtracto = de(FUENTE.extracto);
  const deOperacion = de(FUENTE.operacion);
  const sinPrecio = de(FUENTE.sinPrecio);
  const algunaNoEsDeMercado = aMano.length + delExtracto.length + deOperacion.length + sinPrecio.length > 0;
  return [
    algunaNoEsDeMercado ? "Los demás precios proceden de fuentes de mercado." : "Los precios proceden de fuentes de mercado.",
    aMano.length > 0 ? `Con precio introducido a mano: ${aMano.join("; ")}.` : "",
    delExtracto.length > 0 ? `Con el precio del extracto del banco, más reciente que el de mercado: ${delExtracto.join("; ")}.` : "",
    deOperacion.length > 0 ? `Valoradas al precio de su última operación, por no tener cotización: ${deOperacion.join("; ")}.` : "",
    sinPrecio.length > 0 ? `Sin precio, y por eso cuentan como cero: ${sinPrecio.join("; ")}.` : ""
  ].filter(Boolean).join(" ");
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const conReferencia = analisis.referencia?.disponible === true;
  const glosario = hayCifras(datos) ? GLOSARIO.filter((entrada) => (entrada.id !== "diferenciaConLaReferencia" || conReferencia) && (entrada.id !== "rentabilidadAnualizada" || analisis.rentabilidad?.anualiza === true)) : [];
  const avisos = [
    "Las rentabilidades pasadas no garantizan rentabilidades futuras. El valor de las inversiones puede subir o bajar.",
    "Este informe no es asesoramiento fiscal ni un cálculo de impuestos: los resultados que muestra no son los que se declaran a Hacienda.",
    "Los costes de la cartera se detallan en «Costes de la cartera».",
    notaDeLosPrecios(analisis),
    `Datos a ${fechaLarga(analisis.fecha) ?? analisis.fecha}. Informe generado el ${fechaLarga(datos.generado) ?? datos.generado}.`,
    ...(esDemostracion(datos.cartera) ? ["Cartera de demostración: sus activos, precios y movimientos son inventados."] : [])
  ];
  return (
    <>
      {glosario.length > 0 ? (
        <>
          <Subtitulo>Qué es cada cifra</Subtitulo>
          <Tabla
            columnas={[{ titulo: "Cifra", ancho: 1 }, { titulo: "Qué es", ancho: 3 }]}
            filas={glosario.map((entrada) => {
              const m = metrica(entrada.id);
              return { celdas: [entrada.nombre ?? m.nombre, sinCortarLaUnidad(m.ayuda)] };
            })}
          />
        </>
      ) : null}
      <Subtitulo>Avisos</Subtitulo>
      <Vinetas puntos={avisos} />
    </>
  );
}

export const notas: SeccionDeInforme = {
  id: "notas",
  titulo: "Notas",
  procede: () => true,
  /* Las notas van enteras, con el texto legal que cierra el informe detrás: un glosario partido en dos, o el texto legal solo en la
     última hoja (pasaba el 16-11-2026 con cuarenta posiciones), se lee peor que una hoja final propia. Si no caben, pasan juntas a la siguiente. */
  entera: true,
  Contenido
};
