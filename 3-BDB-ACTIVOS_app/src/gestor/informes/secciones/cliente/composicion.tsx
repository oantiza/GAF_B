/* eslint-disable react-refresh/only-export-components */
/**
 * La cartera, que va antes que las cifras de cómo ha ido (Óscar, 16-11-2026: «la cartera y, después de la cartera, las métricas»).
 * Dos secciones:
 *  - «Su cartera»: lo que tiene a la fecha del informe, posición a posición, y cómo se reparte por clase de activo y por divisa.
 *  - «Dónde está invertida»: la renta variable por región, en el mapa del mundo del papel de cliente (antes, en barras), y por sector.
 */
import { View } from "@react-pdf/renderer";
import { fechaLarga, importe, peso } from "../../../../core/formato";
import { textoDeAusencia } from "../../../../core/textoDeAusencia";
import { MapaDelMundo } from "../../../../reports/informeDeCliente/graficos";
import { ListaDePartes, Parrafo, Tabla } from "../../../../reports/plantilla";
import type { Reparto } from "../../../motor/composicion";
import { notaDeLasSinPrecio } from "../../../motor/sinPrecio";
import { FUENTE } from "../../../motor/valoracion";
import { regionesEnElMapa } from "../../mapaDeRegiones";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { DosColumnas, Pequena, Subtitulo } from "../piezas";

/** Cuántas posiciones se enumeran: todas las de una cartera normal, que no pasa de unas cuarenta. */
export const POSICIONES_EN_EL_INFORME_DEL_CLIENTE = 40;
/* Media hoja vertical (511 pt) menos el hueco entre las dos columnas. */
const MEDIA_HOJA = 245;

const partesDe = (reparto: Reparto) => reparto.lineas.map((linea) => ({ nombre: linea.nombre, fraccion: linea.peso, cifra: peso(linea.peso) }));

function Repartido({ titulo, reparto, ancho }: { titulo: string; reparto: Reparto; ancho?: number }) {
  return (
    <View wrap={false} style={{ marginBottom: 6 }}>
      <Subtitulo>{titulo}</Subtitulo>
      <ListaDePartes ancho={ancho} partes={partesDe(reparto)} />
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Su cartera */

function Cartera({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const c = analisis.composicion;
  const divisa = analisis.cartera.divisaBase;
  const fuentePorActivo = new Map(analisis.posiciones.map((posicion) => [posicion.activo.id, posicion.fuente]));
  const nota = (activoId: string) => {
    const fuente = fuentePorActivo.get(activoId);
    return fuente === FUENTE.manual ? "Valorada con un precio introducido a mano." : fuente === FUENTE.operacion ? "Valorada al precio de su última operación." : undefined;
  };
  const lista = c.principales.slice(0, POSICIONES_EN_EL_INFORME_DEL_CLIENTE);
  const resto = c.principales.length - lista.length;
  /* Lo que no tiene precio no está en la composición, que es de lo que vale algo, pero es del cliente y se lista: al final, con
     su hueco dicho (decisión A-197, 20-11-2026). Hasta entonces no salía en la lista y solo lo decía la nota de los precios. */
  const sinPrecio = analisis.sinPrecio;
  const FALTA = textoDeAusencia("falta");
  const queNoIncluye = notaDeLasSinPrecio(analisis, "Esa cifra");
  return (
    <>
      <Parrafo>{`A ${fechaLarga(analisis.fecha) ?? analisis.fecha} su cartera vale ${importe(analisis.patrimonio, { divisa }) ?? ""}.${queNoIncluye ? ` ${queNoIncluye}` : ""} Estas son sus posiciones, de mayor a menor peso, y cómo se reparte el patrimonio. En los fondos se mira dentro: un fondo mixto cuenta en parte como renta variable y en parte como renta fija. Lo que no se conoce se dice en «Sin clasificar».`}</Parrafo>
      {lista.length + sinPrecio.length > 0 ? (
        <>
          <Subtitulo juntoAlTitulo={90}>Posiciones</Subtitulo>
          <Tabla
            columnas={[{ titulo: "Posición", ancho: 66 }, { titulo: "Valor", ancho: 22, cifra: true }, { titulo: "Peso", ancho: 12, cifra: true }]}
            filas={[
              ...lista.map((posicion) => ({ celdas: [{ texto: posicion.nombre, apunte: nota(posicion.activoId) }, importe(posicion.valor, { divisa }), peso(posicion.peso)] })),
              ...sinPrecio.map((posicion) => ({ celdas: [{ texto: posicion.activo.nombre, apunte: "Sin precio: no se puede valorar." }, FALTA, FALTA] }))
            ]}
          />
          <Pequena separada>
            {resto > 0
              ? `Y ${resto === 1 ? "una posición más" : `${resto} posiciones más`}, de menor peso. El efectivo no está en esta lista: va en el reparto por clase de activo, como liquidez.`
              : "El efectivo no está en esta lista: va en el reparto por clase de activo, como liquidez."}
          </Pequena>
        </>
      ) : null}
      <DosColumnas izquierda={<Repartido titulo="Por clase de activo" reparto={c.porClaseDeActivo} ancho={MEDIA_HOJA} />} derecha={<Repartido titulo="Por divisa" reparto={c.porDivisa} ancho={MEDIA_HOJA} />} />
    </>
  );
}

export const composicion: SeccionDeInforme = {
  id: "composicion",
  titulo: "Su cartera",
  comienzo: "nueva",
  procede: (datos) => hayCifras(datos) && datos.analisis.composicion.porClaseDeActivo.lineas.length > 0,
  Contenido: Cartera
};

/* ------------------------------------------------------------------------------------------------ Dónde está invertida */

function Distribucion({ datos }: { datos: DatosDelInforme }) {
  const c = datos.analisis.composicion;
  const mapa = regionesEnElMapa(c.porRegion);
  const agrupadas = mapa.cifras.filter((cifra) => cifra.zonas).map((cifra) => cifra.label);
  return (
    <>
      <Parrafo>{`Región y sector se refieren a la parte invertida en renta variable, que pesa un ${peso(c.rentaVariable) ?? ""} de la cartera.`}</Parrafo>
      {c.porRegion.lineas.length > 0 ? (
        <>
          <Subtitulo>Por región</Subtitulo>
          <MapaDelMundo totales={mapa.totales} cifras={mapa.cifras} />
          <Pequena separada>
            {`Cada zona se pinta con el color de su cifra, que es la que va debajo del mapa.${agrupadas.includes("Asia y Pacífico") ? " «Asia y Pacífico» incluye Japón y Oceanía." : ""}${agrupadas.includes("Oriente Medio y África") ? " «Oriente Medio y África» se pinta entera, sin repartir entre las dos." : ""}`}
          </Pequena>
        </>
      ) : null}
      {c.porSector.lineas.length > 0 ? <Repartido titulo="Por sector" reparto={c.porSector} /> : null}
    </>
  );
}

export const distribucion: SeccionDeInforme = {
  id: "distribucion",
  titulo: "Dónde está invertida",
  /* Entera: el mapa y su reparto por sector no se separan del título; si no caben detrás de la cartera, pasan juntos a la hoja siguiente. */
  entera: true,
  procede: (datos) => {
    const c = datos.analisis.composicion;
    return hayCifras(datos) && c.rentaVariable > 0 && (c.porRegion.lineas.length > 0 || c.porSector.lineas.length > 0);
  },
  Contenido: Distribucion
};
