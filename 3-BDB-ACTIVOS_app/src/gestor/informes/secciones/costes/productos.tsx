/* eslint-disable react-refresh/only-export-components */
/**
 * «Costes de los productos»: el coste corriente estimado de cada fondo o ETF, con su
 * porcentaje anual, su valor medio en el periodo y lo que supone. El total es `gastosCorrientes`:
 * el análisis lo da como la suma de estas líneas. Debajo, los productos cuyo porcentaje no se
 * conoce, por su nombre: no están incluidos.
 */
import { importe, porcentaje } from "../../../../core/formato";
import { Nota, Parrafo, Tabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Pequena } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const ic = analisis.ingresosYCostes;
  const productos = ic.porProducto;
  const sinDato = ic.productosSinGastosCorrientes;
  return (
    <>
      <Parrafo>Los fondos y ETF cobran un coste corriente anual por gestionarse. No se carga en su cuenta: se descuenta día a día del valor de cada fondo, así que ya está dentro de su rentabilidad. Aquí se estima con el porcentaje anual publicado por cada fondo, aplicado a lo que ha valido de media en el periodo.</Parrafo>
      {productos.length > 0 ? (
        <Tabla
          columnas={[{ titulo: "Fondo o ETF", ancho: 46 }, { titulo: "Coste corriente anual", ancho: 16, cifra: true }, { titulo: "Valor medio", ancho: 19, cifra: true }, { titulo: "Coste estimado", ancho: 19, cifra: true }]}
          filas={productos.map((producto) => ({ celdas: [producto.nombre, porcentaje(producto.gastosCorrientes), importe(producto.valorMedio, { divisa }), importe(producto.coste, { divisa })] }))}
          total={["Total de costes de los productos", "", "", importe(ic.gastosCorrientes, { divisa })]}
        />
      ) : null}
      {sinDato.length > 0 ? (
        productos.length > 0 ? (
          <Nota>{`No se conoce el coste corriente de ${sinDato.length === 1 ? "este producto" : `estos ${sinDato.length} productos`}, así que no está incluido en el total: ${sinDato.join("; ")}.`}</Nota>
        ) : (
          <Parrafo>{`No se conoce el coste corriente de ninguno de los productos de la cartera, así que no hay cifra que dar. Son estos: ${sinDato.join("; ")}.`}</Parrafo>
        )
      ) : null}
      {productos.length > 0 && sinDato.length === 0 ? <Pequena separada>Se conoce el coste corriente de todos los fondos y ETF de la cartera. Las acciones y los bonos no tienen.</Pequena> : null}
    </>
  );
}

export const productos: SeccionDeInforme = {
  id: "productos",
  titulo: "Costes de los productos",
  procede: (datos) => hayCifras(datos) && (datos.analisis.ingresosYCostes.porProducto.length > 0 || datos.analisis.ingresosYCostes.productosSinGastosCorrientes.length > 0),
  Contenido
};
