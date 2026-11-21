import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useModoCliente } from "../../app/ClientModeContext";
import { getAssetDataSource } from "../../adapters/assetDataSource";
import {
  BASE_NUEVA_DISPONIBLE,
  InstrumentoDesconocido,
  leerInstrumento,
  type InstrumentoDeLaBase
} from "../../adapters/baseNuevaLectura";
import { componerFicha } from "../../adapters/componerFicha";
import { decidirFicha, type LecturaDeLaBaseNueva, type LecturaDelActivo } from "../../adapters/decidirFicha";
import {
  accionDeCarteraBloqueada,
  activoParaLaAccion,
  avisoDeAccionDeCartera,
  etiquetaDeAccionDeCartera,
  nombreDeAccionDeCartera,
  nuncaResuelto,
  sinPrecioNiMetricas
} from "../../core/accionDeCartera";
import { iconoDeAccionDeCartera } from "../ui/iconoDeAccionDeCartera";
import { appLogger } from "../../core/appLogger";
import { useAsyncData } from "../../core/useAsyncData";
import { usePestanaEnLaDireccion } from "../../core/usePestanaEnLaDireccion";
import { Ausencia } from "../ui/Ausencia";
import { Aviso } from "../ui/Aviso";
import { Button } from "../ui/Button";
import { Distintivo } from "../ui/Distintivo";
import { Esqueleto } from "../ui/Esqueleto";
import { PageHeader } from "../ui/PageHeader";
import { FichaInstrumento } from "./FichaInstrumento";
import { IDS_DE_PESTANA_DE_LA_FICHA, type PestanaDeLaFicha } from "./mapaDeLaFicha";
import type { AssetDataSourceKind } from "../../types/assetDataSource";
import type { BdbAssetDetail, BdbAssetSearchResult } from "../../types/bdbAssets";
import type { EvolucionDeLaFicha } from "../../types/fichaInstrumento";

const AssetDetailPage = lazy(() =>
  import("../../pages/AssetDetailPage").then((m) => ({ default: m.AssetDetailPage }))
);
const AssetHistoryChart = lazy(() =>
  import("../AssetHistoryChart").then((m) => ({ default: m.AssetHistoryChart }))
);

const valorDe = (documento: unknown, campo: string): unknown =>
  documento && typeof documento === "object" ? (documento as Record<string, unknown>)[campo] : undefined;

/** Cargando: un esqueleto con la forma de la ficha (cabecera, banda y evolución), y el aviso para el lector de pantalla. */
const CARGANDO_LA_FICHA = (
  <div className="ficha-pantalla" role="status">
    <span className="sr-only">Cargando la ficha…</span>
    <Esqueleto lineas={3} />
    <Esqueleto alto={96} />
    <Esqueleto alto={320} />
  </div>
);

/**
 * La ficha de un activo: una pantalla propia, con su dirección y sin pasar por ninguna otra.
 *
 * Hasta el 04-11-2026 la abría el Buscador antiguo, y al pulsar una fila se veían tres pantallas
 * seguidas: su título, la ficha anterior y por fin esta, con una búsqueda de catálogo que nadie había
 * pedido. Si la lectura fallaba, la pantalla se quedaba en el Buscador sin decir nada, y un ISIN que no
 * existe volvía a la lista sin una palabra. Ahora lee lo suyo y solo lo suyo, y lo que se pinta lo
 * decide `decidirFicha`.
 *
 * **La ficha anterior** se queda de respaldo para lo único que no se va con el tiempo: los dos catálogos
 * no son el mismo, y un activo que la base nueva no conoce se pinta con ella. Y para una aplicación que
 * no tenga camino a la base nueva.
 *
 * **La otra lectura** (`getAssetDetail`, la de la función) no bloquea la ficha: de ella salen los
 * fundamentales del emisor, que en la web publicada no existen, y arrancarla en frío tarda segundos que
 * el asesor no tiene por qué esperar delante del cliente.
 */

interface VueltaDeLaFicha {
  /** «Volver a Diseño de cartera», «Volver a los resultados», «Ir al Buscador». */
  etiqueta: string;
  /** Adónde lleva, para que se pueda abrir en otra pestaña como cualquier enlace. */
  direccion: string;
  alVolver: () => void;
}

interface FichaDeActivoProps {
  assetId: string;
  sourceKind: AssetDataSourceKind;
  enCartera: boolean;
  enComparacion: boolean;
  /** Si ya no cabe otro en la comparación. */
  comparacionLlena: boolean;
  onAnadirACartera: (activo: { asset_id: string; display_name: string }) => void;
  onAlternarComparacion: (assetId: string) => void;
  onIrAlBuscador: () => void;
  vuelta: VueltaDeLaFicha;
  /** Cuenta el nombre que se está enseñando, y `null` al cerrarse: lo lee la pestaña del navegador. */
  onNombre?: (nombre: string | null) => void;
}

/** Un identificador con una barra no es un instrumento: ni siquiera se puede preguntar por él. Tampoco uno con
    «?», «#», «%» o un espacio, que construían una petición con consulta o una ruta inválida y salía «No se pudo
    leer» en vez de «No está» (ACT-23). */
const sePuedePreguntarPor = (assetId: string) => assetId.length > 0 && !/[/?#%\s]/.test(assetId);

/** ACT-23: un ISIN se busca sin espacios y en mayúsculas, como lo guarda la base. Lo que no tiene forma de ISIN
    se deja como llega, sin los espacios de los extremos. */
const FORMA_DE_ISIN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;
function identificadorParaPreguntar(deLaDireccion: string): string {
  const sinEspacios = deLaDireccion.replace(/\s+/g, "");
  return FORMA_DE_ISIN.test(sinEspacios) ? sinEspacios.toUpperCase() : deLaDireccion.trim();
}

export function FichaDeActivo({
  assetId: idDeLaDireccion,
  sourceKind,
  enCartera,
  enComparacion,
  comparacionLlena,
  onAnadirACartera,
  onAlternarComparacion,
  onIrAlBuscador,
  vuelta,
  onNombre
}: FichaDeActivoProps) {
  const assetId = identificadorParaPreguntar(idDeLaDireccion);
  /* La pestaña de la ficha va en la dirección: se puede recargar, compartir y volver a ella. */
  const [pestana, setPestana] = usePestanaEnLaDireccion<PestanaDeLaFicha>(IDS_DE_PESTANA_DE_LA_FICHA, "resumen");
  const { activo: modoCliente } = useModoCliente();
  const fuente = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  /* Lo que el papel necesita y la ficha no compone (decisión A-124): la evolución que se está viendo, y el estado de la descarga. */
  const [evolucion, setEvolucion] = useState<EvolucionDeLaFicha | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [errorAlImprimir, setErrorAlImprimir] = useState<string | null>(null);
  useEffect(() => {
    setEvolucion(null);
    setErrorAlImprimir(null);
  }, [assetId]);
  const preguntaALaBaseNueva = BASE_NUEVA_DISPONIBLE && sePuedePreguntarPor(assetId);

  /* El resultado va envuelto: así «todavía nada» se distingue de «ha contestado que no lo tiene». */
  const baseNueva = useAsyncData(
    async () => {
      try {
        return { instrumento: await leerInstrumento(assetId) as InstrumentoDeLaBase | null };
      } catch (causa) {
        if (causa instanceof InstrumentoDesconocido) return { instrumento: null };
        throw causa;
      }
    },
    [assetId],
    { enabled: preguntaALaBaseNueva }
  );
  const delActivo = useAsyncData(
    async () => ({
      activo: sePuedePreguntarPor(assetId) ? ((await fuente.getAssetDetail(assetId)) as BdbAssetDetail | null) : null
    }),
    [assetId, fuente]
  );
  const reintentar = () => {
    baseNueva.retry();
    delActivo.retry();
  };

  const lecturaDeLaBaseNueva: LecturaDeLaBaseNueva<InstrumentoDeLaBase> = !preguntaALaBaseNueva
    ? { estado: "no-lo-conoce" }
    : baseNueva.error
      ? { estado: "no-contesta" }
      : baseNueva.data === null
        ? { estado: "esperando" }
        : baseNueva.data.instrumento === null
          ? { estado: "no-lo-conoce" }
          : { estado: "lo-conoce", instrumento: baseNueva.data.instrumento };
  const lecturaDelActivo: LecturaDelActivo<BdbAssetDetail> = delActivo.error
    ? { estado: "no-contesta" }
    : delActivo.data === null
      ? { estado: "esperando" }
      : delActivo.data.activo === null
        ? { estado: "no-lo-conoce" }
        : { estado: "lo-conoce", activo: delActivo.data.activo };
  const decision = decidirFicha(lecturaDeLaBaseNueva, lecturaDelActivo);

  /* ACT-08: la ficha no espera a la otra lectura, pero de ella salen los fundamentales de una acción. Si aún no ha
     llegado o ha fallado, se dice: sin esto, «Valoración» no estaba y no se sabía si faltaba o si había fallado. */
  const fundamentalesPendientes =
    decision.pantalla === "ficha" && valorDe(decision.instrumento.raiz, "instrument_type") === "STOCK"
      ? lecturaDelActivo.estado === "esperando"
        ? "cargando"
        : lecturaDelActivo.estado === "no-contesta"
          ? "fallo"
          : null
      : null;

  const instrumento = decision.pantalla === "ficha" ? decision.instrumento : null;
  const activo = decision.pantalla === "ficha" || decision.pantalla === "anterior" ? decision.activo : null;
  const fundamentales = activo?.fundamentals_summary;
  const ficha = instrumento ? componerFicha(instrumento, fundamentales, { modoCliente }) : null;

  /* El mismo nombre que el título principal de la pantalla. */
  const nombre = ficha?.nombre ?? activo?.display_name ?? null;
  useEffect(() => {
    onNombre?.(nombre);
    return () => onNombre?.(null);
  }, [nombre, onNombre]);

  if (decision.pantalla === "cargando") return CARGANDO_LA_FICHA;

  if (decision.pantalla === "no-existe") {
    /* En un contenedor, como las demás pantallas: suelta, la cabecera era el hijo directo de `main`, se ponía en
       columna y dejaba el título y el botón a 340 px uno de otro. */
    return (
      <div>
        <PageHeader
          actions={
            <Button onClick={onIrAlBuscador} variant="primary">
              Ir al Buscador
            </Button>
          }
          description={`${assetId} no está en el catálogo. Puede haberse dado de baja o el enlace puede estar mal copiado.`}
          title="No encontramos este activo"
        />
      </div>
    );
  }

  if (decision.pantalla === "no-se-pudo-leer") {
    return (
      <div>
        <PageHeader
          actions={
            <Button onClick={reintentar} variant="primary">
              Reintentar
            </Button>
          }
          description="No hemos podido leer este activo. Vuelve a intentarlo."
          title="No se pudo leer la ficha"
        />
      </div>
    );
  }

  const alVolver = (evento: MouseEvent<HTMLAnchorElement>) => {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    vuelta.alVolver();
  };
  const enlaceDeVuelta = (
    <a className="ficha-pantalla__vuelta" href={vuelta.direccion} onClick={alVolver}>
      <span aria-hidden="true">←</span> {vuelta.etiqueta}
    </a>
  );

  if (decision.pantalla === "anterior") {
    return (
      <div className="ficha-pantalla">
        {enlaceDeVuelta}
        <Suspense fallback={CARGANDO_LA_FICHA}>
          <AssetDetailPage
            asset={decision.activo}
            isCompareDisabled={!enComparacion && (comparacionLlena || sinPrecioNiMetricas(decision.activo))}
            isInPortfolio={enCartera}
            isSelectedForComparison={enComparacion}
            loadHoldings={fuente.getAssetHoldings}
            onAddToPortfolio={(elegido: BdbAssetSearchResult) => onAnadirACartera(elegido)}
            onToggleCompare={onAlternarComparacion}
          />
        </Suspense>
      </div>
    );
  }

  const paraLaAccion = activoParaLaAccion(assetId, decision.instrumento.raiz, activo);
  const avisoDelBoton = avisoDeAccionDeCartera(paraLaAccion);
  /* El papel imprime el MISMO modelo que esta pantalla, compuesto con el mismo modo: no decide nada por su cuenta (decisión A-124).
     El generador se carga al pedirlo, para no arrastrar @react-pdf a la pantalla. */
  const computadaEl = decision.instrumento.tarjeta?.computed_at;
  const imprimir = async () => {
    if (!ficha) return;
    setErrorAlImprimir(null);
    setImprimiendo(true);
    try {
      const { downloadFichaDeActivoPdf } = await import("../../reports/fichaDeActivoPdf");
      await downloadFichaDeActivoPdf({
        ficha,
        isin: assetId,
        modoCliente,
        generado: new Date(),
        datosA: typeof computadaEl === "string" ? computadaEl : undefined,
        evolucion
      });
    } catch (causa) {
      appLogger.error("No se pudo generar el PDF de la ficha", causa);
      setErrorAlImprimir("No se pudo generar la ficha en PDF. Vuelve a intentarlo.");
    } finally {
      setImprimiendo(false);
    }
  };
  /* Si se puede proponer, en la línea de identidad: la misma regla que el botón (ACT-01). */
  const etiquetaDelBoton = etiquetaDeAccionDeCartera(paraLaAccion, enCartera);
  const distintivo =
    etiquetaDelBoton === "No disponible" ? (
      <Distintivo tono="aviso">No se puede proponer</Distintivo>
    ) : etiquetaDelBoton === "Benchmark" ? (
      <Distintivo>Fondo base de las carteras de referencia</Distintivo>
    ) : (
      <Distintivo tono="marca">Se puede proponer</Distintivo>
    );
  return (
    <div className="ficha-pantalla">
      {enlaceDeVuelta}
      <FichaInstrumento
        acciones={
          <>
            <Button busy={imprimiendo} onClick={() => void imprimir()} textoAlTrabajar="Descargando la ficha…" variant="quiet">
              {imprimiendo ? "Descargando la ficha…" : "Descargar ficha"}
            </Button>
            <Button
              disabled={!enComparacion && (comparacionLlena || nuncaResuelto(decision.instrumento.raiz))}
              onClick={() => onAlternarComparacion(assetId)}
              variant="secondary"
            >
              {enComparacion ? "Quitar de la comparación" : "Comparar"}
            </Button>
            <Button
              aria-label={`${nombreDeAccionDeCartera(paraLaAccion, enCartera)}: ${nombre ?? assetId}`}
              disabled={accionDeCarteraBloqueada(paraLaAccion, enCartera)}
              icon={iconoDeAccionDeCartera(etiquetaDelBoton)}
              onClick={() => onAnadirACartera({ asset_id: assetId, display_name: nombre ?? assetId })}
              title={nombreDeAccionDeCartera(paraLaAccion, enCartera)}
              variant="primary"
            >
              {etiquetaDelBoton}
            </Button>
            {/* ACT-01 (14-11-2026): lo bloqueado por calidad del dato se puede añadir, y se avisa, junto al botón y en ocre. */}
            {avisoDelBoton ? <Ausencia clase="falta" motivo={avisoDelBoton} /> : null}
          </>
        }
        alElegirPestana={setPestana}
        avisos={
          errorAlImprimir || fundamentalesPendientes === "fallo" ? (
            <>
              {errorAlImprimir ? <Aviso tono="error">{errorAlImprimir}</Aviso> : null}
              {fundamentalesPendientes === "fallo" ? (
                <Aviso
                  accion={
                    <Button onClick={delActivo.retry} size="sm" variant="secondary">
                      Reintentar los fundamentales
                    </Button>
                  }
                  tono="error"
                >
                  No se han podido leer los fundamentales del emisor: la valoración y el crecimiento no se enseñan.
                </Aviso>
              ) : null}
            </>
          ) : undefined
        }
        distintivo={distintivo}
        evolucion={
          <Suspense fallback={<Esqueleto alto={320} />}>
            <AssetHistoryChart
              alCargar={setEvolucion}
              asset={{ asset_id: assetId, display_name: nombre ?? assetId, quality_flags: activo?.quality_flags ?? [] }}
            />
          </Suspense>
        }
        ficha={ficha!}
        fundamentalesPendientes={
          /* ACT-08: los fundamentales llegan de otra lectura, que puede tardar; su hueco queda reservado. */
          fundamentalesPendientes === "cargando" ? (
            <div className="ficha__cargando" role="status">
              <p className="ficha__nota">Cargando los fundamentales del emisor…</p>
              <Esqueleto lineas={6} />
            </div>
          ) : undefined
        }
        pestana={pestana}
      />
    </div>
  );
}
