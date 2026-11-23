import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { BASE_NUEVA_DISPONIBLE, leerDocumento } from "../adapters/baseNuevaLectura";
import { catalogoYaLeido, leerCatalogoEnSesion } from "../adapters/catalogoEnSesion";
import {
  CLASE_DE_ACTIVO_DEL_BUSCADOR,
  COLUMNAS_DEL_BUSCADOR,
  componerFila,
  nombreDeEscalaDelBuscador,
  TIPO_DE_CIFRA_DEL_BUSCADOR,
  type FilaDeInstrumento
} from "../adapters/componerLista";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { EmptyState } from "../components/ui/AsyncState";
import { useModoCliente } from "../app/ClientModeContext";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { Campo } from "../components/ui/Campo";
import { Cifra } from "../components/ui/Cifra";
import { Esqueleto } from "../components/ui/Esqueleto";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  accionDeCarteraBloqueada,
  activoParaLaAccion,
  avisoDeAccionDeCartera,
  etiquetaDeAccionDeCartera,
  motivoDeNoInvertible,
  NO_SE_ANADE_SIN_MEDIR,
  nombreDeAccionDeCartera
} from "../core/accionDeCartera";
import { iconoDeAccionDeCartera } from "../components/ui/iconoDeAccionDeCartera";
import { historicalSelectionRestriction } from "../core/assetMapping";
import { coincideConLoTecleado, esRespuestaExacta } from "../core/busquedaDeActivos";
import { MAX_COMPARISON_ASSETS } from "../core/comparisonSelection";
import { etiquetaDeReparto } from "../core/etiquetasDeReparto";
import {
  ESTADO_INICIAL_DEL_BUSCADOR,
  hayCriteriosDeBusqueda,
  TODAS,
  type EstadoDelBuscador,
  type TipoDelBuscador
} from "../core/estadoDelBuscador";
import { alternarFavorito, escribirFavoritos, leerFavoritos } from "../core/favoritos";
import { QUALITY_FLAG_LABELS } from "../core/labels";
import { fecha as fechaComun, numero } from "../core/formato";
import { ZONAS_DEL_BUSCADOR, zonaDeLaClave, type ZonaDelBuscador } from "../core/regionTaxonomy";
import { rotuloDeEstrellas } from "../core/estrellasDeMorningstar";
import { useAsyncData } from "../core/useAsyncData";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import "../styles/tabla.css";

/**
 * El buscador: la tabla que sabe de qué método viene cada cifra.
 *
 * Lee las tarjetas de la base nueva en una sola consulta —311 ms y 4 MB medidos contra
 * el emulador—, que es exactamente para lo que la tarjeta existe: ser la fila de una
 * lista. La ficha, en cambio, lee los documentos de un instrumento. Se leen una vez por
 * sesión (`catalogoEnSesion`), y la búsqueda, los filtros, el orden y la página los guarda
 * el marco (`estadoDelBuscador`): ir a una ficha y volver es instantáneo y deja la lista
 * donde estaba.
 *
 * La búsqueda es en memoria sobre las tarjetas ya cargadas, que con 1.091 es instantáneo y
 * con diez mil no lo sería. Es el único Buscador desde el 04-11-2026 (decisión 26): si el
 * catálogo no contesta, lo dice y deja reintentar; no cae a otra pantalla.
 */

const TIPOS: Array<{ id: TipoDelBuscador; label: string }> = [
  { id: "TODOS", label: "Todos" },
  { id: "FUND", label: "Fondos" },
  { id: "STOCK", label: "Acciones" },
  { id: "ETF", label: "ETF" }
];

/** ACT-22: el primer clic en una cifra ordena de mayor a menor, salvo en estas, en las que menos es mejor. */
const DE_MENOR_A_MAYOR = new Set(["volatilidad1a", "volatilidad3a"]);

/** La opción para los que no declaran región: 544 de 1.091, así que no es un detalle. */
const SIN_DECLARAR = "SIN_DECLARAR";
/* Una zona grande va con este prefijo; una subzona, con su clave tal cual, como hasta el 06-11-2026 (así sigue valiendo lo guardado). */
const PREFIJO_DE_ZONA = "zona:";

interface BuscadorNuevoPageProps {
  /** Abre la ficha de un instrumento. Lo inyecta el shell, que es quien sabe de URLs. */
  onAbrirFicha?: (isin: string) => void;
  /** Los ISIN que ya están en la cartera activa. */
  enCartera?: string[];
  /** Los ISIN marcados para comparar. */
  paraComparar?: string[];
  /** El nombre viaja con el ISIN: la cartera guarda la etiqueta que se ve en la fila,
      y la tarjeta es quien la tiene. */
  onAnadirACartera?: (isin: string, nombre: string) => void;
  onAlternarComparacion?: (isin: string) => void;
  onAbrirComparador?: () => void;
  onAbrirCartera?: () => void;
  /** Por dónde va, cuando el marco lo guarda para que sobreviva a ir a una ficha y volver. */
  estado?: EstadoDelBuscador;
  alCambiarEstado?: Dispatch<SetStateAction<EstadoDelBuscador>>;
  /**
   * De dónde se lee el activo que sirve el servidor, que es quien sabe las marcas del equipo (suspendido, cerrado a
   * suscripciones, bloqueado por calidad del dato): la base que lee esta pantalla no las lleva. Sin fuente, al pulsar
   * Añadir se decide solo con lo que dice la base.
   */
  sourceKind?: AssetDataSourceKind;
}

/*
 * Las dos acciones de la fila, en corto, con su icono y sin caja (Óscar, 17-11-2026): como botones con borde ocupaban más que
 * dos columnas de cifras. Comparar es una casilla que se marca: el texto no cambia al marcarla, así la fila no baila.
 */
const ICONO_COMPARAR = (
  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 16 16">
    <rect height="11" rx="2.5" width="11" x="2.5" y="2.5" />
  </svg>
);
const ICONO_COMPARANDO = (
  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
    <rect fill="currentColor" height="11" rx="2.5" width="11" x="2.5" y="2.5" />
    <path d="M5.25 8.25l1.9 1.9 3.6-4.1" strokeWidth="1.6" style={{ stroke: "var(--papel)" }} />
  </svg>
);

/* El favorito, un corazón delante del nombre (Óscar, 17-11-2026, sobre una captura del aspecto anterior): hueco sin marcar, lleno
   al marcarlo. Antes era una estrella al final de la fila, que además se confundía con las de Morningstar. */
const ICONO_FAVORITO = (
  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" viewBox="0 0 16 16">
    <path d="M8 13.6S2.2 10.2 2.2 6.1A3 3 0 0 1 8 4.8a3 3 0 0 1 5.8 1.3c0 4.1-5.8 7.5-5.8 7.5z" />
  </svg>
);
const ICONO_FAVORITO_MARCADO = (
  <svg aria-hidden="true" fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" viewBox="0 0 16 16">
    <path d="M8 13.6S2.2 10.2 2.2 6.1A3 3 0 0 1 8 4.8a3 3 0 0 1 5.8 1.3c0 4.1-5.8 7.5-5.8 7.5z" />
  </svg>
);

/** Lo que le pasó a una fila al pulsar Añadir: un motivo para no añadirla, o un fallo al comprobarlo. */
type AvisoDeFila = { texto: string; bloqueada: boolean; etiqueta?: string };

export function BuscadorNuevoPage({
  onAbrirFicha,
  enCartera = [],
  paraComparar = [],
  onAnadirACartera,
  onAlternarComparacion,
  onAbrirComparador,
  onAbrirCartera,
  estado: estadoGuardado,
  alCambiarEstado,
  sourceKind
}: BuscadorNuevoPageProps) {
  const { seEnsena } = useModoCliente();
  const conProveedor = seEnsena("fuenteDeDatos");
  const fuente = useMemo(() => (sourceKind ? getAssetDataSource(sourceKind) : null), [sourceKind]);
  const [estadoPropio, setEstadoPropio] = useState(ESTADO_INICIAL_DEL_BUSCADOR);
  const estado = estadoGuardado ?? estadoPropio;
  const guardar = alCambiarEstado ?? setEstadoPropio;
  const cambiar = (cambio: Partial<EstadoDelBuscador>) => guardar((previo) => ({ ...previo, ...cambio }));
  const { tipo, busqueda, clase, region, soloFavoritos } = estado;
  const categoria = estado.categoria ?? TODAS;

  const [favoritos, setFavoritos] = useState<string[]>(leerFavoritos);
  const [avisos, setAvisos] = useState<Record<string, AvisoDeFila>>({});
  const [consultando, setConsultando] = useState<string | null>(null);

  const { data: tarjetas, error, loading, retry } = useAsyncData(
    () => leerCatalogoEnSesion(),
    [],
    { enabled: BASE_NUEVA_DISPONIBLE, initialData: catalogoYaLeido() }
  );
  const data = useMemo(() => tarjetas?.map(componerFila) ?? null, [tarjetas]);

  /* Al volver de una ficha, por donde iba. Desde 1.440 px se desplaza la página, y por debajo la
     propia pantalla (tabla.css): se anotan las dos cosas y vale la que se esté moviendo. */
  const raiz = useRef<HTMLDivElement>(null);
  const anotarDesplazamiento = () =>
    cambiar({
      desplazamiento: {
        pagina: window.scrollY,
        arriba: raiz.current?.scrollTop ?? 0,
        izquierda: raiz.current?.scrollLeft ?? 0
      }
    });
  const desplazamiento = estado.desplazamiento;
  useLayoutEffect(() => {
    if (desplazamiento === null) return;
    window.scrollTo({ top: desplazamiento.pagina, behavior: "auto" });
    raiz.current?.scrollTo?.({ top: desplazamiento.arriba, left: desplazamiento.izquierda });
    guardar((previo) => ({ ...previo, desplazamiento: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ultimaPasada = (data ?? []).reduce<string | undefined>((ultima, fila) => (fila.calculadaEl && (!ultima || fila.calculadaEl > ultima) ? fila.calculadaEl : ultima), undefined);

  const alternar = (isin: string) =>
    setFavoritos((previos) => {
      const siguiente = alternarFavorito(previos, isin);
      escribirFavoritos(siguiente);
      return siguiente;
    });

  /* Las opciones salen del dato, no de una lista escrita a mano: una clase que el
     catálogo no tiene no se ofrece, y una nueva aparece sola. */
  const clases = useMemo(() => {
    const vistas = new Set((data ?? []).map((f) => f.claseDeActivo).filter(Boolean) as string[]);
    return [...vistas].sort((a, b) =>
      (CLASE_DE_ACTIVO_DEL_BUSCADOR[a] ?? a).localeCompare(CLASE_DE_ACTIVO_DEL_BUSCADOR[b] ?? b, "es")
    );
  }, [data]);

  /* Cada zona grande, con las subzonas que la tienen como mayor debajo: para afinar sin perder «Europa» entera. */
  const zonas = useMemo(() => {
    const vistas = new Map<ZonaDelBuscador, Set<string>>();
    for (const fila of data ?? []) {
      if (!fila.zona) continue;
      const subzonas = vistas.get(fila.zona) ?? new Set<string>();
      if (fila.region && zonaDeLaClave(fila.region) === fila.zona) subzonas.add(fila.region);
      vistas.set(fila.zona, subzonas);
    }
    return ZONAS_DEL_BUSCADOR.filter((zona) => vistas.has(zona)).map((zona) => ({
      zona,
      subzonas: [...(vistas.get(zona) ?? [])].sort((a, b) => etiquetaDeReparto(a).localeCompare(etiquetaDeReparto(b), "es"))
    }));
  }, [data]);

  const categorias = useMemo(() => {
    const vistas = new Set((data ?? []).map((f) => f.categoria).filter(Boolean) as string[]);
    return [...vistas].sort((a, b) => a.localeCompare(b, "es"));
  }, [data]);

  /* Los favoritos solo cuentan si filtran: marcar un favorito (el corazón) no cambia la lista, y si contaran
     devolvería a la primera página a quien la pulsa en la tercera. */
  const favoritosQueFiltran = soloFavoritos ? favoritos : null;
  const filas = useMemo(
    () =>
      (data ?? []).filter(
        (fila: FilaDeInstrumento) =>
          (tipo === "TODOS" || fila.tipo === tipo) &&
          (clase === TODAS || fila.claseDeActivo === clase) &&
          (region === TODAS ||
            (region === SIN_DECLARAR
              ? fila.zona === undefined
              : region.startsWith(PREFIJO_DE_ZONA)
                ? fila.zona === region.slice(PREFIJO_DE_ZONA.length)
                : fila.region === region)) &&
          (categoria === TODAS || fila.categoria === categoria) &&
          (favoritosQueFiltran === null || favoritosQueFiltran.includes(fila.isin)) &&
          coincideConLoTecleado(fila, busqueda)
      ),
    [data, tipo, clase, region, categoria, favoritosQueFiltran, busqueda]
  );

  const recuento = `${numero(filas.length) ?? "0"} de ${numero(data?.length ?? 0) ?? "0"} activos`;
  /* ACT-11: el recuento se anuncia medio segundo después del último cambio, no en cada tecla. */
  const [recuentoAnunciado, setRecuentoAnunciado] = useState("");
  const hayCatalogo = data !== null;
  useEffect(() => {
    if (!hayCatalogo) return;
    const espera = window.setTimeout(() => setRecuentoAnunciado(recuento), 500);
    return () => window.clearTimeout(espera);
  }, [recuento, hayCatalogo]);

  /* Lista por nombre, «SAN» encontraba primero Artisan. Lo que responde exactamente a lo tecleado va delante; si se ordena por una
     cifra, manda la cifra. */
  const ordenPorNombre = estado.tabla.orden === "nombre";
  const responde = useMemo(
    () => (ordenPorNombre ? (fila: FilaDeInstrumento) => esRespuestaExacta(fila, busqueda) : undefined),
    [ordenPorNombre, busqueda]
  );

  /*
   * Al pulsar Añadir se consulta el instrumento: la tarjeta dice si dejó de cotizar desde el 05-11-2026, y
   * una que no lo traiga aún (la nube, hasta que se suba el catálogo) no prueba que siga cotizando. Y
   * añadir algo que ya no cotiza hace quedar mal delante del cliente. Si no se puede comprobar, no se
   * añade a ciegas: se dice y se puede volver a pulsar.
   */
  const anadir = async (isin: string, nombre: string) => {
    if (!onAnadirACartera) return;
    setConsultando(isin);
    setAvisos((previos) => Object.fromEntries(Object.entries(previos).filter(([clave]) => clave !== isin)));
    try {
      /* Decide la regla común, la de la ficha y el Comparador (ACT-01); `motivoDeNoInvertible` solo pone las palabras.
         Con el activo que sirve el servidor, como la ficha: es quien trae las marcas del equipo. Si no contesta, se decide
         con lo que dice la base, que es lo que se hacía hasta el 14-11-2026. */
      const [raizLeida, delServidor] = await Promise.all([
        leerDocumento(`instruments/${isin}`),
        fuente ? fuente.getAssetDetail(isin).catch(() => null) : Promise.resolve(null)
      ]);
      const paraLaAccion = activoParaLaAccion(isin, raizLeida, delServidor);
      if (accionDeCarteraBloqueada(paraLaAccion, false)) {
        const restriccion = historicalSelectionRestriction({ quality_flags: paraLaAccion.quality_flags ?? [] });
        const texto =
          motivoDeNoInvertible(isin, nombre, raizLeida) ??
          (restriccion && QUALITY_FLAG_LABELS[restriccion] ? `${nombre}. ${QUALITY_FLAG_LABELS[restriccion]}.` : `${nombre}: no se añade a la propuesta.`);
        const etiqueta = etiquetaDeAccionDeCartera(paraLaAccion, false);
        setAvisos((previos) => ({ ...previos, [isin]: { texto, bloqueada: true, etiqueta } }));
      } else {
        onAnadirACartera(isin, nombre);
        /* Lo bloqueado por calidad del dato se añade, y se avisa (decisión de Óscar del 14-11-2026). */
        const aviso = avisoDeAccionDeCartera(paraLaAccion);
        if (aviso) {
          setAvisos((previos) => ({
            ...previos,
            [isin]: { texto: `${nombre}, añadido. ${aviso}: queda fuera de las métricas de la cartera.`, bloqueada: false }
          }));
        }
      }
    } catch {
      setAvisos((previos) => ({
        ...previos,
        [isin]: { texto: `No hemos podido comprobar si ${nombre} se puede añadir. Vuelve a intentarlo.`, bloqueada: false }
      }));
    } finally {
      setConsultando(null);
    }
  };

  /* La columna de acciones se añade aquí y no en `COLUMNAS_DEL_BUSCADOR` porque
     depende del estado de esta pantalla. Si nadie pasa los manejadores la columna no
     existe, en vez de salir con botones muertos. */
  const columnas = useMemo<ColumnaDeTabla<FilaDeInstrumento>[]>(() => {
    const delCatalogo = COLUMNAS_DEL_BUSCADOR.map((columna) => {
      /* El corazón del favorito va delante del nombre, en su misma celda. Pulsarlo no abre la ficha. */
      if (columna.id === "nombre") {
        return {
          ...columna,
          celda: (fila: FilaDeInstrumento) => {
            const marcado = favoritos.includes(fila.isin);
            return {
              ...columna.celda(fila),
              antes: (
                <button
                  aria-label={`Marcar ${fila.nombre} como favorito`}
                  aria-pressed={marcado}
                  className="tabla__favorito"
                  onClick={(evento) => {
                    evento.stopPropagation();
                    alternar(fila.isin);
                  }}
                  title={marcado ? "Quitar de favoritos" : "Marcar como favorito"}
                  type="button"
                >
                  {marcado ? ICONO_FAVORITO_MARCADO : ICONO_FAVORITO}
                </button>
              )
            };
          }
        };
      }
      /* El rótulo de las estrellas nombra al proveedor solo con la fuente a la vista (`fuenteDeDatos`; H3-01). */
      if (columna.id === "estrellas") return { ...columna, titulo: rotuloDeEstrellas(conProveedor) };
      /* Las cifras, con la pieza común: el mismo formato y, en la rentabilidad, el color de su signo. El texto se queda para ordenar. */
      const tipo = TIPO_DE_CIFRA_DEL_BUSCADOR[columna.id];
      if (!tipo) return columna;
      return {
        ...columna,
        celda: (fila: FilaDeInstrumento) => {
          const base = columna.celda(fila);
          if (typeof base.valor !== "number" || base.ausencia) return base;
          /* Un `nodo` gana sobre el texto y su apunte: el apunte de la cifra (el Sharpe del proveedor, A-171) va con ella. */
          return {
            ...base,
            nodo: base.apunte ? (
              <>
                <Cifra tipo={tipo} valor={base.valor} />
                <span className="tabla__apunte">{base.apunte}</span>
              </>
            ) : (
              <Cifra tipo={tipo} valor={base.valor} />
            )
          };
        }
      };
    });
    if (!onAnadirACartera && !onAlternarComparacion) return delCatalogo;
    return [
      ...delCatalogo,
      {
        id: "acciones",
        titulo: "Añadir o comparar",
        tituloOculto: true,
        acciones: true,
        celda: (f) => {
          const dentro = enCartera.includes(f.isin);
          const comparando = paraComparar.includes(f.isin);
          /* La regla común con lo que dice la tarjeta (ACT-01): la misma etiqueta y el mismo bloqueo que la ficha. Lo que
             dice la raíz al pulsar, si la tarjeta no lo traía, queda en el aviso. */
          const paraLaAccion = activoParaLaAccion(f.isin, { availability: { state: f.estadoDeCotizacion } });
          const aviso = avisos[f.isin]?.bloqueada ? avisos[f.isin] : undefined;
          const bloqueada = accionDeCarteraBloqueada(paraLaAccion, false) || aviso !== undefined;
          const etiqueta = aviso?.etiqueta ?? etiquetaDeAccionDeCartera(paraLaAccion, dentro);
          /* Lo que avisa al pulsar es «No disponible» o «Benchmark», que se dicen igual en corto y en largo. */
          const nombreDeLaAccion = aviso?.etiqueta ?? nombreDeAccionDeCartera(paraLaAccion, dentro);
          return {
            texto: "",
            nodo: (
              <span>
                {/* Los dos dicen de qué fondo hablan: en una tabla de 80 filas, un lector de
                    pantalla anunciaba «Añadir» 80 veces. Y el nombre empieza por lo que se lee en el botón
                    (WCAG 2.5.3): quien lo dicta por voz dice «Añadir» y tiene que encontrarlo. */}
                {onAnadirACartera ? (
                  <Button
                    aria-label={`${nombreDeLaAccion}: ${f.nombre}`}
                    className="tabla__accion tabla__accion--principal"
                    disabled={dentro || bloqueada || consultando === f.isin}
                    icon={iconoDeAccionDeCartera(etiqueta)}
                    onClick={() => void anadir(f.isin, f.nombre)}
                    size="sm"
                    title={nombreDeLaAccion}
                    variant="quiet"
                  >
                    {etiqueta}
                  </Button>
                ) : null}
                {onAlternarComparacion ? (
                  /* Una casilla: marcada, se compara; pulsarla otra vez la quita. El estado lo dice `aria-pressed`. */
                  <Button
                    aria-label={`Comparar ${f.nombre}`}
                    aria-pressed={comparando}
                    className="tabla__accion"
                    disabled={!comparando && (paraComparar.length >= MAX_COMPARISON_ASSETS || f.sinPrecioNiMetricas === true)}
                    icon={comparando ? ICONO_COMPARANDO : ICONO_COMPARAR}
                    onClick={() => onAlternarComparacion(f.isin)}
                    size="sm"
                    title={comparando ? "Quitar de la comparación" : "Marcar para comparar"}
                    variant="quiet"
                  >
                    Comparar
                  </Button>
                ) : null}
              </span>
            )
          };
        }
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `anadir` solo cierra sobre lo que ya está aquí
  }, [onAnadirACartera, onAlternarComparacion, enCartera, paraComparar, favoritos, avisos, consultando, conProveedor]);

  return (
    <div className="buscador-nuevo" ref={raiz}>
      {/* La mesa de trabajo de antes son ahora las acciones de la cabecera: comparar lo marcado y ver la propuesta. */}
      <PageHeader
        eyebrow="Activos"
        actions={
          onAbrirComparador && onAbrirCartera ? (
            <>
              <Button onClick={onAbrirCartera} variant="quiet">
                {`Ver la propuesta (${enCartera.length})`}
              </Button>
              {paraComparar.length > 0 ? (
                <Button disabled={paraComparar.length < 2} onClick={onAbrirComparador} variant="secondary">
                  {paraComparar.length === 1 ? "Comparar 1 activo" : `Comparar ${paraComparar.length} activos`}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        description={
          <>
            {data ? `${numero(data.length) ?? "0"} ${data.length === 1 ? "activo" : "activos"} del catálogo` : "Fondos, ETF y acciones del catálogo"}
            {ultimaPasada ? ` · base actualizada el ${fechaComun(ultimaPasada) ?? ultimaPasada}` : ""}
            {" · "}rentabilidad y volatilidad en euros; las marcadas «proveedor», en la divisa que él publique.
          </>
        }
        title="Buscador"
      />

      {!BASE_NUEVA_DISPONIBLE ? (
        <EmptyState
          description="Esta instalación de la aplicación no está conectada al catálogo de activos, así que no hay nada que enseñar aquí sin inventarlo. Tiene que revisarlo quien la administra."
          title="Sin acceso al catálogo"
        />
      ) : (
        <>
          <div className="buscador-nuevo__mandos">
            <Campo className="buscador-nuevo__buscar" rotulo="Buscar">
              <input
                onChange={(evento) => cambiar({ busqueda: evento.target.value })}
                placeholder="Nombre, ticker o ISIN"
                type="search"
                value={busqueda}
              />
            </Campo>
            {/* ACT-10 / DIR-10: es una elección, no pestañas: no hay ningún panel que controlar. */}
            <SegmentedControl
              label="Producto"
              onChange={(siguiente) => cambiar({ tipo: siguiente })}
              options={TIPOS}
              value={tipo}
            />
            <Campo className="buscador-nuevo__select" rotulo="Clase de activo">
              <select onChange={(evento) => cambiar({ clase: evento.target.value })} value={clase}>
                <option value={TODAS}>Todas</option>
                {clases.map((valor) => (
                  <option key={valor} value={valor}>
                    {CLASE_DE_ACTIVO_DEL_BUSCADOR[valor] ?? valor}
                  </option>
                ))}
              </select>
            </Campo>
            {/* «Dominante» y no «Región» a secas: es la que más pesa de las que el
                instrumento declara, no una etiqueta que nadie le ha puesto. */}
            <Campo className="buscador-nuevo__select" rotulo="Región dominante">
              <select onChange={(evento) => cambiar({ region: evento.target.value })} value={region}>
                <option value={TODAS}>Todas</option>
                {zonas.map(({ zona, subzonas }) => (
                  <optgroup key={zona} label={zona}>
                    <option value={PREFIJO_DE_ZONA + zona}>{zona}, entera</option>
                    {subzonas.map((valor) => (
                      <option key={valor} value={valor}>
                        {zona} · {etiquetaDeReparto(valor)}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={SIN_DECLARAR}>No la declara</option>
              </select>
            </Campo>
            <Campo className="buscador-nuevo__select" rotulo="Categoría">
              <select onChange={(evento) => cambiar({ categoria: evento.target.value })} value={categoria}>
                <option value={TODAS}>Todas</option>
                {categorias.map((valor) => (
                  <option key={valor} value={valor}>
                    {valor}
                  </option>
                ))}
              </select>
            </Campo>
            <label className="buscador-nuevo__casilla">
              <input
                checked={soloFavoritos}
                onChange={(evento) => cambiar({ soloFavoritos: evento.target.checked })}
                type="checkbox"
              />
              <span>Solo favoritos</span>
            </label>
            {/* La búsqueda sobrevive a la sesión, así que hace falta una forma de empezar de cero. */}
            {hayCriteriosDeBusqueda(estado) ? (
              <Button
                onClick={() =>
                  cambiar({
                    busqueda: ESTADO_INICIAL_DEL_BUSCADOR.busqueda,
                    tipo: ESTADO_INICIAL_DEL_BUSCADOR.tipo,
                    clase: ESTADO_INICIAL_DEL_BUSCADOR.clase,
                    region: ESTADO_INICIAL_DEL_BUSCADOR.region,
                    categoria: ESTADO_INICIAL_DEL_BUSCADOR.categoria,
                    soloFavoritos: ESTADO_INICIAL_DEL_BUSCADOR.soloFavoritos
                  })
                }
                size="sm"
                variant="quiet"
              >
                Limpiar búsqueda y filtros
              </Button>
            ) : null}
            <p className="buscador-nuevo__cuantos">{recuento}</p>
            {/* ACT-11: el recuento, para quien usa un lector de pantalla, cuando se deja de teclear. */}
            <p className="sr-only" role="status">
              {recuentoAnunciado}
            </p>
          </div>

          {error && !data ? (
            <EmptyState
              action={
                <Button onClick={retry} variant="primary">
                  Reintentar
                </Button>
              }
              description="El catálogo no ha contestado. Comprueba la conexión y vuelve a intentarlo."
              title="No hemos podido leer el catálogo"
            />
          ) : null}
          {loading && !data ? (
            <div role="status">
              <span className="sr-only">Cargando el catálogo…</span>
              <Esqueleto lineas={12} />
            </div>
          ) : null}

          {data ? (
            <>
              {/* B4 (Óscar, 21-11-2026): lo que impide comparar dos cifras va encima de la tabla, como aviso, y no en una frase de
                  la cabecera que se pasaba por alto. Es una regla del método (§3): dos cifras solo se comparan si coinciden en el
                  estimador. */}
              {filas.length > 0 ? (
                <Aviso tono="nota" titulo="Cifras de métodos distintos.">
                  Al ordenar por una cifra, la tabla agrupa los activos por su método de cálculo: dentro de cada grupo se comparan,
                  y entre grupos no.
                </Aviso>
              ) : null}
              {filas.length > 0 ? (
                <TablaDeDatos
                  alAbrir={
                    onAbrirFicha
                      ? (fila) => {
                          anotarDesplazamiento();
                          onAbrirFicha(fila.isin);
                        }
                      : undefined
                  }
                  alCambiarEstado={(tabla) =>
                    /* ACT-22: al ordenar por primera vez una columna en la que más es mejor, lo mejor arriba.
                       La volatilidad sigue empezando por lo menor, que también es lo mejor. */
                    cambiar({
                      tabla:
                        tabla.orden !== estado.tabla.orden &&
                        tabla.orden !== null &&
                        !DE_MENOR_A_MAYOR.has(tabla.orden) &&
                        columnas.some((columna) => columna.id === tabla.orden && columna.cifra)
                          ? { ...tabla, sentido: -1 }
                          : tabla
                    })
                  }
                  columnas={columnas}
                  deActivos
                  detalleDe={(fila) =>
                    fila.dejoDeCotizar !== undefined ? (
                      <p className="buscador-nuevo__aviso">Dejó de cotizar el {fechaComun(fila.dejoDeCotizar) ?? fila.dejoDeCotizar}: no se añade a la propuesta.</p>
                    ) : fila.valoradoAPrecioCongelado !== undefined ? (
                      <p className="buscador-nuevo__aviso">{fila.valoradoAPrecioCongelado}</p>
                    ) : fila.sinPrecioNiMetricas ? (
                      <p className="buscador-nuevo__aviso">{NO_SE_ANADE_SIN_MEDIR}</p>
                    ) : motivoDeNoInvertible(fila.isin, fila.nombre, {}) ? (
                      /* Con una raíz vacía solo habla de los fondos base, que la fila ya bloquea sin consultar. */
                      <p className="buscador-nuevo__aviso">{motivoDeNoInvertible(fila.isin, fila.nombre, {})}</p>
                    ) : avisos[fila.isin] ? (
                      <p className="buscador-nuevo__aviso">{avisos[fila.isin].texto}</p>
                    ) : undefined
                  }
                  estado={estado.tabla}
                  filas={filas}
                  nombreDeEscala={nombreDeEscalaDelBuscador}
                  porPagina
                  primero={responde}
                  titulo="Activos del catálogo"
                />
              ) : soloFavoritos && favoritos.length === 0 ? (
                /* ACT-22: sin favoritos no es que la búsqueda no encuentre nada. */
                <EmptyState
                  description="Aún no has marcado ningún favorito. Quita «Solo favoritos» y pulsa el corazón de un activo para marcarlo."
                  title="No tienes favoritos"
                />
              ) : (
                <EmptyState
                  description="Prueba con otro nombre, ticker o ISIN, o quita algún filtro."
                  title="No hay activos que coincidan"
                />
              )}
              {/* El aviso se ve bajo su fila; esto es para quien usa un lector de pantalla. */}
              <p className="sr-only" role="status">
                {Object.values(avisos).at(-1)?.texto ?? ""}
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
