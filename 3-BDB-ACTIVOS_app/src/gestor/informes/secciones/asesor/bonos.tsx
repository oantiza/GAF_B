/* eslint-disable react-refresh/only-export-components */
/**
 * Bonos en cartera: nominal, cupón corrido a la fecha, vencimiento y los cobros de los dos
 * años siguientes, en la divisa de cada bono.
 */
import { View } from "@react-pdf/renderer";
import { fecha, importe, porcentaje } from "../../../../core/formato";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Pequena, TablaCompacta } from "../piezas";

const PAGOS: Record<number, string> = { 1: "cupón anual", 2: "cupón semestral", 4: "cupón trimestral", 12: "cupón mensual" };

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  return (
    /* Con pocos bonos, la tabla y su nota van juntas: la nota sola abría una hoja apaisada casi vacía. */
    <View wrap={analisis.bonos.length > 8}>
      <TablaCompacta
        columnas={[{ titulo: "Bono", ancho: 236 }, { titulo: "Nominal", ancho: 90, cifra: true }, { titulo: "Cupón", ancho: 60, cifra: true }, { titulo: "Cupón corrido", ancho: 90, cifra: true }, { titulo: "Vencimiento", ancho: 80 }, { titulo: "Próximos cobros (dos años)", ancho: 200 }]}
        filas={analisis.bonos.map((b) => {
          const divisa = b.activo.divisa;
          const cupon = b.activo.bono ? Number(b.activo.bono.cupon) : null;
          return [
            { texto: b.activo.nombre, apunte: [b.activo.isin ?? b.activo.id, b.activo.bono ? `${PAGOS[b.activo.bono.frecuencia] ?? `${b.activo.bono.frecuencia} pagos al año`} · base ${b.activo.bono.base}` : ""].filter(Boolean).join(" · ") },
            importe(b.nominal, { divisa }),
            porcentaje(cupon),
            b.cuponCorrido === null ? { texto: null, apunte: "Sin precio" } : importe(b.cuponCorrido, { divisa }),
            `${fecha(b.vencimiento) ?? ""}${b.vencido ? " (vencido)" : ""}`,
            b.proximos.length > 0 ? b.proximos.map((p) => `${fecha(p.fecha) ?? ""} ${p.clase === "cupon" ? "cupón" : "nominal"} ${importe(p.importe, { divisa }) ?? ""}`).join("\n") : "Ninguno"
          ];
        })}
      />
      <Pequena>{`Importes brutos, antes de retenciones. El cupón corrido es lo devengado desde el último pago, por el nominal en cartera.${analisis.bonos.some((b) => b.cuponCorrido === null) ? " De un bono sin precio no se da: la posición no tiene valor." : ""}`}</Pequena>
    </View>
  );
}

export const bonos: SeccionDeInforme = {
  id: "bonos",
  titulo: "Bonos",
  apaisada: true,
  juntoAlTitulo: 110,
  procede: (datos) => datos.analisis.bonos.length > 0,
  Contenido
};
