import { listarTarjetas } from "../adapters/baseNuevaLectura";
import { componerEstado, type EstadoDelCatalogo } from "../adapters/componerEstado";
import { cuantos, fecha, numero } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { useAsyncData } from "../core/useAsyncData";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";

/** Un recuento, con su punto de millar siempre (PLA-12). */
const recuento = (valor: number) => numero(valor) ?? "";

interface FilaDeRecuento {
  id: string;
  rotulo: string;
  cuantos: number;
}

const COLUMNAS_DE_RECUENTO: ColumnaDeTabla<FilaDeRecuento>[] = [
  { id: "rotulo", titulo: "Qué", encabezaFila: true, sinOrden: true, celda: (fila) => ({ texto: fila.rotulo }) },
  { id: "cuantos", titulo: "Activos", cifra: true, sinOrden: true, celda: (fila) => ({ texto: recuento(fila.cuantos), valor: fila.cuantos }) }
];

type FondoParaRevisar = EstadoDelCatalogo["paraRevisar"][number] & { id: string };

const COLUMNAS_PARA_REVISAR: ColumnaDeTabla<FondoParaRevisar>[] = [
  /* El nombre es un enlace de verdad a la ficha: se enfoca, se abre con Intro y en otra pestaña. */
  { id: "fondo", titulo: "Fondo", encabezaFila: true, celda: (fondo) => ({ texto: fondo.nombre, valor: fondo.nombre, enlaceAFicha: fondo.isin }) },
  { id: "discrepa", titulo: "Qué se separa", celda: (fondo) => ({ texto: fondo.discrepa, valor: fondo.discrepa }) },
  {
    id: "fecha",
    titulo: "Dato del proveedor",
    celda: (fondo) =>
      fondo.fecha ? { texto: fecha(fondo.fecha) ?? fondo.fecha, valor: fondo.fecha } : { texto: textoDeAusencia("falta"), ausencia: "falta" }
  }
];

/** Cómo está el catálogo y qué fondos hay que mirar. Lee las tarjetas: 1.091 lecturas por visita. */
export function EstadoDelCatalogoPanel() {
  const { data, error, loading, retry } = useAsyncData(async () => componerEstado(await listarTarjetas()), []);

  if (error) return <AsyncErrorBanner error={error} onRetry={retry} />;
  if (loading || !data) {
    return (
      <>
        <p className="sr-only">Leyendo el catálogo…</p>
        <Esqueleto lineas={6} />
      </>
    );
  }

  const recuentos: FilaDeRecuento[] = [
    { id: "activos", rotulo: "Activos", cuantos: data.instrumentos },
    { id: "propias", rotulo: "Con métricas nuestras", cuantos: data.propias },
    { id: "proveedor", rotulo: "Con cifras del proveedor", cuantos: data.delProveedor },
    { id: "sin-cifras", rotulo: "Sin cifras", cuantos: data.sinCifras },
    ...data.cierres.map((cierre) => ({
      id: `cierre-${cierre.fecha}`,
      rotulo: `Fondos y ETF con cierre a ${fecha(cierre.fecha) ?? cierre.fecha}`,
      cuantos: cierre.fondos
    }))
  ];
  const paraRevisar: FondoParaRevisar[] = data.paraRevisar.map((fondo) => ({ ...fondo, id: fondo.isin }));

  return (
    <div className="stack">
      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo={
          data.ultimaPasada
            ? `Última actualización el ${fecha(data.ultimaPasada) ?? data.ultimaPasada}. Los datos no se actualizan solos: se refrescan a mano.`
            : "Los datos no se actualizan solos: se refrescan a mano."
        }
        titulo="Estado del catálogo"
      >
        <TablaDeDatos columnas={COLUMNAS_DE_RECUENTO} filas={recuentos} titulo="Recuentos del catálogo" />
      </Panel>

      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo="Nuestra cifra se separa de la del proveedor más que en el 99 % del catálogo. No quiere decir que esté mal: quiere decir que hay que mirarla. Solo se comparan clases en euros y al mismo cierre."
        titulo={`Para revisar: ${cuantos(data.paraRevisar.length, "fondo", "fondos")}`}
      >
        <TablaDeDatos columnas={COLUMNAS_PARA_REVISAR} filas={paraRevisar} porPagina titulo="Fondos que el control señala" />
      </Panel>
    </div>
  );
}
