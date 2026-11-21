/* eslint-disable react-refresh/only-export-components */
/**
 * Composición a la fecha: los cinco repartos (tipo de producto, clase de activo, divisa,
 * región y sector), con valor y peso, y la concentración.
 */
import { View } from "@react-pdf/renderer";
import { importe, numero, peso } from "../../../../core/formato";
import { textoDeAusencia } from "../../../../core/textoDeAusencia";
import { Tabla } from "../../../../reports/plantilla";
import type { Reparto } from "../../../motor/composicion";
import { notaDeLasSinPrecio } from "../../../motor/sinPrecio";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Pequena, RejillaConSigno, Subtitulo } from "../piezas";

function TablaDeReparto({ titulo, reparto, divisa, pie }: { titulo: string; reparto: Reparto; divisa: string; pie?: string }) {
  return (
    <View wrap={false} style={{ width: "50%", paddingRight: 10.5, marginBottom: 4 }}>
      <Subtitulo>{titulo}</Subtitulo>
      {reparto.lineas.length > 0 ? (
        <Tabla
          columnas={[{ titulo: "", ancho: 50 }, { titulo: "Valor", ancho: 32, cifra: true }, { titulo: "Peso", ancho: 18, cifra: true }]}
          filas={reparto.lineas.map((linea) => ({ celdas: [linea.nombre, importe(linea.valor, { divisa }), peso(linea.peso)] }))}
        />
      ) : (
        <Pequena>{textoDeAusencia("falta")}</Pequena>
      )}
      {pie ? <Pequena>{pie}</Pequena> : null}
    </View>
  );
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const c = analisis.composicion;
  const noIncluye = notaDeLasSinPrecio(analisis, "El reparto");
  const divisa = analisis.cartera.divisaBase;
  /* Dos repartos por fila, cada uno en media hoja (los importes van con sus dos decimales), y cada fila es un bloque: con
     una sola fila que se reparte sola (`flexWrap`), @react-pdf mandaba el último reparto a una hoja aparte. */
  const fila = { flexDirection: "row" as const, marginRight: -10.5 };
  return (
    <>
      <RejillaConSigno
        columnas={4}
        datos={[
          { rotulo: "Mayor posición", valor: peso(c.mayorPosicion), apunte: c.principales[0]?.nombre },
          { rotulo: "Cinco mayores", valor: peso(c.cincoMayores) },
          { rotulo: "Renta variable (mirando dentro de los fondos)", valor: peso(c.rentaVariable) },
          { rotulo: "Posiciones", valor: numero(c.principales.length) }
        ]}
      />
      {/* El reparto y el recuento son de lo que se puede valorar: una posición sin precio no entra, y se dice. */}
      {noIncluye ? <Pequena>{noIncluye}</Pequena> : null}
      <View style={fila} wrap={false}>
        <TablaDeReparto titulo="Por producto" reparto={c.porTipoDeProducto} divisa={divisa} />
        <TablaDeReparto titulo="Por clase de activo" reparto={c.porClaseDeActivo} divisa={divisa} />
      </View>
      <View style={fila} wrap={false}>
        <TablaDeReparto titulo="Por divisa" reparto={c.porDivisa} divisa={divisa} />
        <TablaDeReparto titulo="Por región (renta variable)" reparto={c.porRegion} divisa={divisa} pie="Pesos sobre la parte de renta variable." />
      </View>
      <View style={fila} wrap={false}>
        <TablaDeReparto titulo="Por sector (renta variable)" reparto={c.porSector} divisa={divisa} pie="Pesos sobre la parte de renta variable." />
      </View>
    </>
  );
}

export const composicion: SeccionDeInforme = {
  id: "composicion",
  titulo: "Composición",
  procede: (datos) => !datos.analisis.vacia && datos.analisis.composicion.porTipoDeProducto.lineas.length > 0,
  Contenido
};
