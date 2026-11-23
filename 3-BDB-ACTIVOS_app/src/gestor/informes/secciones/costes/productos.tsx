/* eslint-disable react-refresh/only-export-components */
/**
 * «Costes de los productos»: el coste corriente estimado de cada fondo o ETF, con su
 * porcentaje anual, su valor medio en el periodo y lo que supone. El total es `gastosCorrientes`:
 * el análisis lo da como la suma de estas líneas. Debajo, por su nombre y con su razón, los productos
 * que no están incluidos: los que no tienen porcentaje conocido y los que no tienen precio (P2-07,
 * 22-11-2026: antes estos últimos no se nombraban, y el papel daba el total por completo).
 */
import { importe, porcentaje } from "../../../../core/formato";
import { Nota, Parrafo, Tabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Pequena } from "../piezas";
import { gastosCorrientesCompletos } from "./comun";

/** «este producto», «estos 3 productos». */
const cuales = (cuantos: number) => (cuantos === 1 ? "este producto" : `estos ${cuantos} productos`);
const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const ic = analisis.ingresosYCostes;
  const productos = ic.porProducto;
  const sinDato = ic.productosSinGastosCorrientes;
  const sinPrecio = ic.sinPrecioFueraDeLosGastosCorrientes;
  const deParte = ic.valoradosSoloParteDelPeriodo;
  const noTienenPrecio = `${conMayuscula(cuales(sinPrecio.length))} no ${sinPrecio.length === 1 ? "tiene" : "tienen"} precio, así que no se conoce su valor`;
  return (
    <>
      <Parrafo>Los fondos y ETF cobran un coste corriente anual por gestionarse. No se carga en su cuenta: se descuenta día a día del valor de cada fondo, así que ya está dentro de su rentabilidad. Aquí se estima con el porcentaje anual publicado por cada fondo, aplicado a lo que ha valido de media en el periodo.</Parrafo>
      {productos.length > 0 ? (
        <>
          <Tabla
            columnas={[{ titulo: "Fondo o ETF", ancho: 46 }, { titulo: "Coste corriente anual", ancho: 16, cifra: true }, { titulo: "Valor medio", ancho: 19, cifra: true }, { titulo: "Coste estimado", ancho: 19, cifra: true }]}
            filas={productos.map((producto) => ({ celdas: [producto.nombre, porcentaje(producto.gastosCorrientes), importe(producto.valorMedio, { divisa }), importe(producto.coste, { divisa })] }))}
            total={["Total de costes de los productos", "", "", importe(ic.gastosCorrientes, { divisa })]}
          />
          {sinDato.length > 0 ? <Nota>{`No se conoce el coste corriente de ${cuales(sinDato.length)}, así que no ${sinDato.length === 1 ? "está incluido" : "están incluidos"} en el total: ${sinDato.join("; ")}.`}</Nota> : null}
          {sinPrecio.length > 0 ? <Nota>{`${noTienenPrecio} ni su coste corriente, y no ${sinPrecio.length === 1 ? "está incluido" : "están incluidos"} en el total: ${sinPrecio.join("; ")}.`}</Nota> : null}
          {deParte.length > 0 ? <Nota>{`${conMayuscula(cuales(deParte.length))} no ${deParte.length === 1 ? "tuvo" : "tuvieron"} precio o tipo de cambio parte del periodo, y de esos días no se conoce su valor: su coste corriente solo cuenta los días en que sí lo ${deParte.length === 1 ? "tuvo" : "tuvieron"}, y el total no está completo: ${deParte.join("; ")}.`}</Nota> : null}
        </>
      ) : sinDato.length > 0 || sinPrecio.length > 0 ? (
        <Parrafo>
          {[
            "No se conoce el coste corriente de ninguno de los fondos y ETF de la cartera, así que no hay cifra que dar.",
            sinDato.length > 0 ? `No se conoce el porcentaje anual de ${cuales(sinDato.length)}: ${sinDato.join("; ")}.` : null,
            sinPrecio.length > 0 ? `${noTienenPrecio}: ${sinPrecio.join("; ")}.` : null
          ]
            .filter(Boolean)
            .join(" ")}
        </Parrafo>
      ) : null}
      {productos.length > 0 && gastosCorrientesCompletos(datos) ? <Pequena separada>Se conoce el coste corriente de todos los fondos y ETF de la cartera. Las acciones y los bonos no tienen.</Pequena> : null}
    </>
  );
}

export const productos: SeccionDeInforme = {
  id: "productos",
  titulo: "Costes de los productos",
  procede: (datos) => {
    const ic = datos.analisis.ingresosYCostes;
    return hayCifras(datos) && (ic.porProducto.length > 0 || ic.productosSinGastosCorrientes.length > 0 || ic.sinPrecioFueraDeLosGastosCorrientes.length > 0);
  },
  Contenido
};
