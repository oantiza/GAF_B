/**
 * Bloque 6: en qué está invertida la cartera, repartida de cinco maneras. Mirando dentro de
 * los fondos donde la plataforma lo sabe; lo que no sabe repartir se dice, no se reparte.
 */
import { ListaDePartes } from "../../../components/ui/ListaDePartes";
import { Panel } from "../../../components/ui/Panel";
import type { Analisis } from "../../motor/analisis";
import type { Reparto } from "../../motor/composicion";
import { notaDeLasSinPrecio } from "../../motor/sinPrecio";
import { escrito } from "../textos";
import { colorDeLaParteDeClase } from "./lectura";

const SIN_CLASIFICAR = /^sin clasificar$/i;

/**
 * Un reparto en partes. `porClase`: las partes son clases de activo y cada una lleva su color de toda la aplicación
 * (14-11-2026, Óscar: «le faltan colores en general»), con «Otros» y «Sin clasificar» apagados. Los demás repartos
 * (divisa, región, sector, producto) siguen en el marino de la pieza: no son clases de activo.
 */
function ListaDeReparto({ titulo, reparto, divisa, porClase = false }: { titulo: string; reparto: Reparto; divisa: string; porClase?: boolean }) {
  if (reparto.lineas.length === 0) return null;
  return (
    <div>
      <h3 className="gestor-subtitulo">{titulo}</h3>
      <ListaDePartes
        etiqueta={titulo}
        partes={reparto.lineas.map((linea) => ({
          nombre: linea.nombre,
          fraccion: linea.peso,
          apunte: escrito.importeTitular(linea.valor, divisa),
          ...(porClase ? colorDeLaParteDeClase(linea.nombre) : { apagada: SIN_CLASIFICAR.test(linea.nombre) })
        }))}
      />
    </div>
  );
}

export function BloqueComposicion({ analisis }: { analisis: Analisis }) {
  const { composicion } = analisis;
  const divisa = analisis.cartera.divisaBase;
  if (composicion.porTipoDeProducto.lineas.length === 0) return null;
  const conRentaVariable = composicion.rentaVariable > 0 && (composicion.porRegion.lineas.length > 0 || composicion.porSector.lineas.length > 0);
  const noIncluye = notaDeLasSinPrecio(analisis, "El reparto");
  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={`A ${escrito.fecha(analisis.fecha)}, sobre ${escrito.importeTitular(analisis.patrimonio, divisa)}`} titulo="Composición">
      <div className="gestor-repartos">
        <ListaDeReparto divisa={divisa} porClase reparto={composicion.porClaseDeActivo} titulo="Por clase de activo" />
        <ListaDeReparto divisa={divisa} reparto={composicion.porDivisa} titulo="Por divisa" />
        {conRentaVariable ? <ListaDeReparto divisa={divisa} reparto={composicion.porRegion} titulo="Renta variable por región" /> : null}
        {conRentaVariable ? <ListaDeReparto divisa={divisa} reparto={composicion.porSector} titulo="Renta variable por sector" /> : null}
        <ListaDeReparto divisa={divisa} reparto={composicion.porTipoDeProducto} titulo="Por producto" />
      </div>
      <p className="cmp-note">
        {conRentaVariable
          ? `La región y el sector se refieren solo a la parte de renta variable, que es el ${escrito.peso(composicion.rentaVariable)} de la cartera. `
          : "La cartera no tiene renta variable: no hay reparto por región ni por sector. "}
        «Sin clasificar» es lo que la plataforma no sabe repartir: no se reparte a ojo.
        {/* El reparto es de lo que se puede valorar: una posición sin precio no entra, y se dice. */}
        {noIncluye ? ` ${noIncluye}` : ""}
      </p>
    </Panel>
  );
}
