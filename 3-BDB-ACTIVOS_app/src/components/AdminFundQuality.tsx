import { useMemo, useState } from "react";
import { Aviso } from "./ui/Aviso";
import { fetchFundQuality, fetchFundProfile, type FundQualityRow } from "../adapters/fundQualityBackend";
import { useAsyncData } from "../core/useAsyncData";
import { fecha, fechaYHora, numero } from "../core/formato";
import { MARCAS_DE_LA_REVISION_DEL_HISTORICO, readableBackendLabel } from "../core/labels";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { LoadingState } from "./ui/AsyncState";
import { Button } from "./ui/Button";
import { KpiStrip } from "./ui/KpiStrip";
import { PageHeader } from "./ui/PageHeader";

/* PLA-12: fechas y recuentos con el formato común de la aplicación («13/11/2026», «13/11/2026 10:30», «1.097»), y lo
   que no llega se dice con su palabra: nunca una raya ni «N/D», que se leen como un dato. */
const FALTA = textoDeAusencia("falta");
const diaDe = (iso?: string | null) => (iso ? (fecha(iso) ?? iso) : FALTA);
const momentoDe = (iso?: string | null) => (iso ? (fechaYHora(iso) ?? iso) : FALTA);
const recuento = (valor: number) => numero(valor) ?? FALTA;

const LABELS: Record<string, string> = {
  /* Las siete de la revisión del histórico tienen un solo nombre en toda la aplicación (decisión 120). */
  ...MARCAS_DE_LA_REVISION_DEL_HISTORICO,
  SIN_HISTORICO_UTILIZABLE: "Sin histórico apto para cálculo",
  HISTORICO_ANTIGUO: "Histórico con más de 7 días",
  SIN_POSICIONES: "Sin posiciones", POSICIONES_ANTIGUAS: "Posiciones con más de 90 días o sin fecha",
  SOLO_POSICIONES_PRINCIPALES: "Solo posiciones principales", SIN_DOCUMENTO_KID: "Falta documento KID",
  KID_ANTIGUO: "Documento KID con más de 12 meses",
  RECUENTO_POSICIONES_PENDIENTE: "Recuento de cartera pendiente de conciliar",
  FECHAS_CARTERA_DISCREPANTES: "Resumen y posiciones con fechas distintas",
  CARTERA_PUBLICADA_PARCIAL: "Composición publicada parcial",
  CARTERA_RECIENTE_NO_SUSTITUIDA: "Respuesta reciente insuficiente: se conserva la cartera anterior",
  BAJA_CNMV_VERIFICADA: "Baja por fusión verificada en CNMV",
  RENTA_FIJA_INCOMPLETA: "Renta fija: faltan duración, rendimiento o calidad crediticia"
};

/** Como Inspección: 765 filas sin paginar eran 80.860 px de alto. */
const FILAS_POR_PAGINA = 50;

type FilaDeCalidad = FilaAgrupable & { fondo: FundQualityRow };

const COLUMNAS: ColumnaDeTabla<FilaDeCalidad>[] = [
  {
    id: "fondo",
    titulo: "Fondo / ISIN",
    nombre: true,
    celda: ({ fondo }) => ({ texto: fondo.name, valor: fondo.name, apunte: fondo.isin })
  },
  {
    id: "historico",
    titulo: "Histórico utilizable",
    celda: ({ fondo }) => {
      const observaciones = `${recuento(fondo.history_observations ?? 0)} observaciones`;
      const referencia = (fondo.reference_history_observations ?? 0) > 0
        ? ` · Referencia mensual: ${fondo.reference_history_observations != null ? recuento(fondo.reference_history_observations) : FALTA} observaciones, ${diaDe(fondo.reference_history_first_date)} – ${diaDe(fondo.reference_history_last_date)}`
        : "";
      return fondo.history_first_date
        ? {
            texto: `${diaDe(fondo.history_first_date)} – ${diaDe(fondo.history_last_date)}`,
            valor: fondo.history_first_date,
            apunte: `${observaciones}${referencia}`
          }
        : { texto: textoDeAusencia("falta"), ausencia: "falta", apunte: `${observaciones}${referencia}` };
    }
  },
  {
    id: "posiciones",
    titulo: "Posiciones",
    cifra: true,
    celda: ({ fondo }) => ({
      texto: recuento(fondo.holdings_count ?? 0),
      valor: fondo.holdings_count,
      apunte: diaDe(fondo.holdings_date)
    })
  },
  {
    id: "documentacion",
    titulo: "Documentación",
    /* Con espacio duro lo que no debe partirse: en una columna estrecha «Ficha / ampliada / KID disponible · / Ficha: /
       30/06/2026» eran cinco líneas por fondo, y la fila entera medía lo que esa celda. */
    celda: ({ fondo }) => ({
      texto: fondo.has_profile ? "Ficha\u00a0ampliada" : "Sin ficha\u00a0ampliada",
      apunte: `${fondo.has_kid ? "KID\u00a0disponible" : "KID\u00a0pendiente"} · Ficha:\u00a0${diaDe(fondo.report_date)}`
    })
  },
  {
    id: "revision",
    titulo: "Revisión pendiente",
    /* Una lista de motivos: a 768 px se quedaba con 150 px y cada fondo ocupaba diez líneas. */
    prosa: true,
    celda: ({ fondo }) => ({
      texto: fondo.flags.length
        ? fondo.flags.map((flag) => LABELS[flag] ?? "Dato pendiente de revisión").join(" · ")
        : "Sin incidencias en los controles aplicados",
      valor: fondo.flags.length
    })
  }
];

/** Un ISIN no se «humaniza»: salía «Lu1442549025». Y una fecha se escribe como las demás. */
function valorDeLaFicha(rotulo: string, valor: string): string {
  if (rotulo === "ISIN") return valor;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? diaDe(valor) : readableBackendLabel(valor);
}

export function AdminFundQuality() {
  const { data, error, loading, retry } = useAsyncData(fetchFundQuality, []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const profile = useAsyncData(() => fetchFundProfile(selected!), [selected], { enabled: Boolean(selected) });
  /* Memorizado a propósito: la tabla vuelve a la primera página cuando cambian sus filas, y abrir una
     ficha no debe sacarte de la página en que estás. */
  const filas = useMemo<FilaDeCalidad[]>(() => {
    const buscado = search.toLocaleLowerCase("es");
    return (data?.rows ?? [])
      .filter((row) =>
        `${row.isin} ${row.name}`.toLocaleLowerCase("es").includes(buscado) &&
        (filter === "all" || (filter === "review" ? row.flags.length > 0 : row.flags.includes(filter)))
      )
      .sort((a, b) => Number(b.history_blocked) - Number(a.history_blocked) || b.flags.length - a.flags.length || a.name.localeCompare(b.name, "es"))
      .map((fondo) => ({ id: fondo.isin, fondo }));
  }, [data, search, filter]);
  const columnas = useMemo<ColumnaDeTabla<FilaDeCalidad>[]>(() => [
    ...COLUMNAS,
    {
      id: "ficha",
      titulo: "Ficha",
      acciones: true,
      celda: ({ fondo }) => ({
        texto: "",
        nodo: (
          <Button onClick={() => setSelected(selected === fondo.isin ? null : fondo.isin)} size="sm" variant="quiet">
            {selected === fondo.isin ? "Cerrar ficha" : "Ver ficha"}
          </Button>
        )
      })
    }
  ], [selected]);

  return <section className="admin-quality">
    <PageHeader level="section" title="Calidad de fondos"
      description="Cobertura, documentación y tramos históricos admitidos para cálculo. La disponibilidad comercial requiere confirmación independiente."
      actions={<Button onClick={retry} disabled={loading}>Actualizar vista</Button>} />
    {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : null}
    {loading ? <LoadingState>Consultando calidad de fondos…</LoadingState> : null}
    {data ? <div className="stack stack--tight">
      <KpiStrip items={[
        { label: "Fondos", value: data.total_funds }, { label: "Ficha ampliada", value: data.with_profile },
        { label: "Con histórico utilizable", value: data.with_history }, { label: "Con documento KID", value: data.with_kid },
        { label: "Rentabilidad por conciliar", value: data.history_blocked },
        { label: "Con referencia mensual", value: data.with_monthly_reference ?? 0 }
      ]} />
      <Aviso tono="nota">Corte del inventario: {momentoDe(data.generated_at)}. Los avisos usan umbrales de revisión de 7 días para precios y 90 para posiciones; no certifican la idoneidad del fondo. Los datos originales se conservan.</Aviso>
      {(data.with_monthly_reference ?? 0) > 0 ? <Aviso tono="nota">Las referencias mensuales amplían la información histórica. No sustituyen la serie diaria necesaria para valorar carteras ni la cobertura semanal del optimizador. Sus fechas se muestran por separado.</Aviso> : null}
      <div className="admin-quality-filters">
        <label>Buscar fondo<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre o ISIN" /></label>
        <label>Mostrar<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Todos los fondos</option><option value="review">Con avisos</option>
          {Object.entries(LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select></label>
      </div>
      <p>{filas.length} fondos en esta selección.</p>
      <TablaDeDatos
        columnas={columnas}
        /* La ficha se abre bajo su fila, no encima de la tabla y fuera de la vista. */
        detalleDe={({ fondo }) => (selected === fondo.isin ? (
          <>
            {profile.loading ? <LoadingState>Cargando ficha…</LoadingState> : null}
            {profile.error ? <AsyncErrorBanner error={profile.error} onRetry={profile.retry} /> : null}
            {!profile.loading && profile.data ? <dl className="admin-quality-ficha">{Object.entries(profile.data).map(([label, value]) => <div key={label}><dt>{readableBackendLabel(label)}</dt><dd>{valorDeLaFicha(label, value)}</dd></div>)}</dl> : null}
            {!profile.loading && !profile.error && !profile.data ? <p>Ficha ampliada pendiente de incorporar.</p> : null}
          </>
        ) : undefined)}
        filas={filas}
        porPagina={FILAS_POR_PAGINA}
        titulo="Perfil de calidad del fondo"
      />
    </div> : null}
  </section>;
}
