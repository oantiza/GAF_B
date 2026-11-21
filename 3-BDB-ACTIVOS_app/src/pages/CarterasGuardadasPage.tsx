import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { ConflictoAlGuardar } from "../adapters/conflictoAlGuardar";
import type { AppRouteId } from "../app/appRoutes";
import { useModoCliente } from "../app/ClientModeContext";
import type { CicloDeCartera } from "../app/useCicloDeCartera";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { GuardarCarteraDialog } from "../components/GuardarCarteraDialog";
import { RadiografiaDeLaCartera } from "../components/RadiografiaDeLaCartera";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { Ausencia } from "../components/ui/Ausencia";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { Campo } from "../components/ui/Campo";
import { Distintivo } from "../components/ui/Distintivo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { MenuButton } from "../components/ui/MenuButton";
import { PageHeader } from "../components/ui/PageHeader";
import { useConfirm } from "../components/ui/useConfirm";
import { fecha, importe, peso } from "../core/formato";
import { persistirCartera } from "../core/guardarCartera";
import { perfilYHorizonteDe, SIN_DEFINIR, textoDelHorizonte } from "../core/perfilYHorizonte";
import { createSavedLocalPortfolio } from "../core/portfolio";
import { auditarCartera, sumaDeLaCartera, type AuditoriaDeCartera, type SumaDeLaCartera } from "../core/radiografiaDeLaCartera";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { nombreDelNivel } from "../core/textoDelNivelDePerfil";
import { useAsyncData } from "../core/useAsyncData";
import { useSavedPortfolios } from "../core/useSavedPortfolios";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbSavedLocalPortfolio } from "../types/bdbAssets";
import type { CeldaDeTabla, ColumnaDeTabla } from "../types/tablaDeDatos";
import "../styles/tabla.css";
import "../styles/diseno.css";

/**
 * Propuestas guardadas: la tabla del menú (decisión 26 de Óscar, 04-11-2026; rediseño del 14-11-2026, con buscar,
 * duplicar y renombrar, DIS-12; desde el 16-11-2026, «Eliminar» a la vista en cada fila y no dentro de «Más»). Antes la entrada del menú montaba todo
 * Diseño de cartera con un bloque encima, y esta tabla vivía en otra dirección, fuera del menú y leyendo otra lista.
 *
 * **Lee lo mismo en las dos bases: lo que la cuenta del asesor dice que tiene** (`useSavedPortfolios`), que es lo que se
 * puede abrir y eliminar. En la web son los documentos de la base nueva y en local los de la de siempre, y por eso esta
 * pantalla ya no lee `portfolios` por su cuenta.
 *
 * Lo que añade a una lista de nombres son tres preguntas: si sus pesos cuadran, si el catálogo conoce todas sus posiciones
 * y qué parte de su renta variable puede explicar una radiografía por sector. Las dos últimas y la radiografía salen de los
 * activos que lee Análisis (`getComparableAssets`) y de las funciones que llama Análisis: la misma cifra para la misma cartera
 * y la misma base (decisión 50). Si no se pueden leer, la tabla sigue sirviendo: lo que depende de ellos dice que falta y las
 * carteras se abren igual.
 */

interface FilaDeCartera {
  id: string;
  cartera: BdbSavedLocalPortfolio;
  suma: SumaDeLaCartera;
  auditoria: AuditoriaDeCartera | null;
}

/* DIS-07: la suma de pesos, con un decimal, como en Diseño y en la barra superior. */
const textoDePeso = (suma: number) => peso(suma / 100) ?? textoDeAusencia("falta");

function celdaDeSuma({ suma, cuadrada }: SumaDeLaCartera): CeldaDeTabla {
  return cuadrada
    ? { texto: textoDePeso(suma), valor: suma }
    : { texto: `${textoDePeso(suma)} · no cuadra`, ausencia: "falta", valor: suma };
}

/** Lo que depende de los activos, mientras llegan o si no llegan. «Falta» mientras se leen diría algo que no se sabe. */
const celdaSinAuditoria = (leyendo: boolean): CeldaDeTabla =>
  leyendo ? { texto: "Leyendo…" } : { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" };

function celdaDeCatalogo(auditoria: AuditoriaDeCartera | null, leyendo: boolean): CeldaDeTabla {
  if (!auditoria) return celdaSinAuditoria(leyendo);
  return auditoria.fuera.length === 0
    ? { texto: "Ninguna", valor: 0 }
    : { texto: String(auditoria.fuera.length), ausencia: "falta", valor: auditoria.fuera.length };
}

/** Sobre la renta variable, como la radiografía. Sin renta variable no hay sectores que declarar: no falta nada. */
function celdaDeSectores(auditoria: AuditoriaDeCartera | null, leyendo: boolean): CeldaDeTabla {
  if (!auditoria) return celdaSinAuditoria(leyendo);
  const declarados = auditoria.sectoresDeclaradosPct;
  return declarados === null
    ? { texto: "Sin renta variable", ausencia: "no-aplica" }
    : { texto: `${textoDePeso(declarados)} de la RV`, valor: declarados };
}

/**
 * Lo mismo que las tres columnas, en una línea, para donde no caben: nada se pierde al estrechar. Tampoco la marca: «no
 * cuadra» y «N fuera del catálogo» llevan la de lo que falta, como en sus columnas anchas.
 */
function resumenDeAuditoria({ suma, cuadrada }: SumaDeLaCartera, auditoria: AuditoriaDeCartera | null): ReactNode {
  const pesos = cuadrada ? (
    `Suman ${textoDePeso(suma)}`
  ) : (
    <>
      Suman {textoDePeso(suma)}, <Ausencia clase="falta" motivo="no cuadra" />
    </>
  );
  if (!auditoria) return pesos;
  const declarados = auditoria.sectoresDeclaradosPct;
  return (
    <>
      {pesos}
      {" · "}
      {auditoria.fuera.length === 0 ? "todas en el catálogo" : <Ausencia clase="falta" motivo={`${auditoria.fuera.length} fuera del catálogo`} />}
      {" · "}
      {declarados === null ? "sin renta variable" : `sectores declarados: ${textoDePeso(declarados)} de la renta variable`}
    </>
  );
}

/** Para buscar sin que importen las mayúsculas ni las tildes: «garcia» encuentra «García». */
const paraBuscar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .trim();

/**
 * Cuántas propuestas guardadas no se pueden leer, en una frase. En la cuenta, el servidor las descarta y las demás se cargan; en este navegador
 * siguen guardadas aunque no salgan (IMP-9: guardar otra ya no las borra), y se dice para que nadie las dé por perdidas.
 */
function textoDeLasQueNoSeLeen(cuantas: number, enLaCuenta: boolean): string {
  if (enLaCuenta) {
    return cuantas === 1
      ? "Una propuesta guardada en tu cuenta no se ha podido leer y no aparece en la lista; las demás se han cargado."
      : `${cuantas} propuestas guardadas en tu cuenta no se han podido leer y no aparecen en la lista; las demás se han cargado.`;
  }
  return cuantas === 1
    ? "Una propuesta guardada en este navegador no se puede leer y no aparece en la lista; sigue guardada, no se ha borrado."
    : `${cuantas} propuestas guardadas en este navegador no se pueden leer y no aparecen en la lista; siguen guardadas, no se han borrado.`;
}

/** El nombre de la copia: «Cliente A (copia)», y si ya existe, «Cliente A (copia 2)». */
function nombreDeLaCopia(nombre: string, guardados: readonly string[]): string {
  const ocupados = new Set(guardados.map(paraBuscar));
  const base = `${nombre.trim()} (copia)`;
  if (!ocupados.has(paraBuscar(base))) return base;
  for (let numero = 2; ; numero += 1) {
    const candidato = `${nombre.trim()} (copia ${numero})`;
    if (!ocupados.has(paraBuscar(candidato))) return candidato;
  }
}

export function CarterasGuardadasPage(props: {
  sourceKind: AssetDataSourceKind;
  ciclo?: CicloDeCartera;
  onIrA?: (destino: AppRouteId) => void;
}) {
  const { seEnsena } = useModoCliente();
  /* Son de otros clientes (decisión 19). Se llega también escribiendo la dirección. */
  if (!seEnsena("otrasCarteras")) {
    return (
      <div className="carteras">
        <PageHeader eyebrow="Propuestas" title="Propuestas guardadas" />
        <EmptyState nivel={2} title="No disponible en modo cliente" description="Las propuestas guardadas son de otros clientes. Sal de Modo cliente para verlas." />
      </div>
    );
  }
  return <ListaDeCarteras {...props} />;
}

function ListaDeCarteras({
  sourceKind,
  ciclo,
  onIrA
}: {
  sourceKind: AssetDataSourceKind;
  ciclo?: CicloDeCartera;
  onIrA?: (destino: AppRouteId) => void;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState<ReadonlySet<string>>(() => new Set());
  const [duplicando, setDuplicando] = useState<ReadonlySet<string>>(() => new Set());
  const [busqueda, setBusqueda] = useState("");
  /* «Renombrar»: la que se renombra, y el error del último intento. */
  const [renombrando, setRenombrando] = useState<{ cartera: BdbSavedLocalPortfolio; guardando: boolean; error: string | null } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const conGuardia = ciclo?.conGuardia ?? ((accion: () => void) => accion());

  const saved = useSavedPortfolios({
    sourceKind,
    onLoad: (positions, capital, nombre, cartera) => {
      /* Una propuesta guardada trae su nombre y, al abrirla, pasa a ser la que está en curso. */
      ciclo?.sustituir({ positions, capital, nombre, perfilYHorizonte: perfilYHorizonteDe(cartera) }, cartera);
      onIrA?.("cartera");
    },
    onNotice: setAviso
  });

  /* Los mismos activos que lee Análisis: los de todas las propuestas de una vez, y Análisis los encontrará en la caché. */
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const idsDeLasCarteras = useMemo(
    () => [...new Set(saved.savedPortfolios.flatMap((cartera) => cartera.positions.map((posicion) => posicion.asset_id)))].sort(),
    [saved.savedPortfolios]
  );
  const activos = useAsyncData(() => dataSource.getComparableAssets(idsDeLasCarteras), [dataSource, idsDeLasCarteras.join("|")], {
    enabled: idsDeLasCarteras.length > 0
  });
  /* Mientras se leen o si fallan, lo de antes no vale: una propuesta recién guardada saldría «fuera del catálogo». */
  const activosLeidos = activos.loading || activos.error ? null : activos.data;

  const todas = useMemo<FilaDeCartera[]>(
    () =>
      saved.savedPortfolios.map((cartera) => ({
        id: cartera.portfolio_id,
        cartera,
        suma: sumaDeLaCartera(cartera.positions),
        auditoria: activosLeidos ? auditarCartera(cartera.positions, activosLeidos) : null
      })),
    [saved.savedPortfolios, activosLeidos]
  );
  /* Buscar por nombre: lo que se escribe filtra la tabla, sin tildes ni mayúsculas. */
  const filas = useMemo(() => {
    const buscado = paraBuscar(busqueda);
    return buscado ? todas.filter((fila) => paraBuscar(fila.cartera.name).includes(buscado)) : todas;
  }, [busqueda, todas]);
  const nombres = saved.savedPortfolios.map((cartera) => cartera.name);

  function abrir(cartera: BdbSavedLocalPortfolio) {
    /* Si lo que hay en Diseño tiene cambios sin guardar, el marco pregunta antes. */
    conGuardia(() => saved.load(cartera));
  }

  /* «Nueva propuesta»: Diseño como recién abierto, igual que su «Nueva propuesta», y con la misma guarda. */
  function nuevaPropuesta() {
    conGuardia(() => {
      ciclo?.sustituir({ positions: [], capital: undefined, nombre: "" }, null);
      onIrA?.("cartera");
    });
  }

  /* Borra y no hay vuelta atrás: se pregunta, nombrando cuál. DIS-12: mientras se borra, la fila no admite otra
     pulsación, que lanzaba otra pregunta y otra llamada. */
  async function eliminar(cartera: BdbSavedLocalPortfolio) {
    if (eliminando.has(cartera.portfolio_id)) return;
    const esLaAbierta = ciclo?.abierta?.portfolio_id === cartera.portfolio_id;
    const confirmado = await confirm({
      title: `¿Eliminar ${cartera.name}?`,
      message: esLaAbierta
        ? "No se puede deshacer. Es la que está abierta en Diseño de cartera: lo que hay allí se queda, sin guardar."
        : "No se puede deshacer.",
      confirmLabel: "Eliminar",
      tone: "danger"
    });
    if (!confirmado) return;
    if (abierta === cartera.portfolio_id) setAbierta(null);
    setEliminando((actual) => new Set(actual).add(cartera.portfolio_id));
    try {
      await saved.remove(cartera.portfolio_id);
    } finally {
      setEliminando((actual) => {
        const siguen = new Set(actual);
        siguen.delete(cartera.portfolio_id);
        return siguen;
      });
    }
  }

  /**
   * DIS-12: «Duplicar» crea otra propuesta igual, «(copia)», por el mismo almacén que «Guardar» (`persistirCartera`): sus
   * posiciones, su capital, su perfil y su horizonte, tal como están guardados. La original no se toca.
   */
  async function duplicar(cartera: BdbSavedLocalPortfolio) {
    if (duplicando.has(cartera.portfolio_id)) return;
    setDuplicando((actual) => new Set(actual).add(cartera.portfolio_id));
    const nombre = nombreDeLaCopia(cartera.name, nombres);
    try {
      const copia = {
        ...createSavedLocalPortfolio({ sourceKind, name: nombre, positions: cartera.positions, totalCapital: cartera.total_capital }),
        ...perfilYHorizonteDe(cartera)
      };
      const { enLaCuenta } = await persistirCartera(sourceKind, copia);
      setAviso(`${nombre} guardada ${enLaCuenta ? "en tu cuenta" : "en este navegador"}. ${cartera.name} sigue como estaba.`);
    } catch {
      setAviso(`No se ha podido duplicar ${cartera.name}. No se ha guardado nada: inténtalo de nuevo.`);
    } finally {
      setDuplicando((actual) => {
        const siguen = new Set(actual);
        siguen.delete(cartera.portfolio_id);
        return siguen;
      });
    }
  }

  /**
   * DIS-12: «Renombrar» cambia el nombre y nada más, por el mismo almacén que «Guardar», y con el mismo control de
   * conflictos (DIS-03): si la guardada ha cambiado o ya no está desde que se leyó la lista, el servidor no la pisa y se
   * dice. La que está abierta en Diseño no se renombra desde aquí: Diseño la tiene con su nombre, y su próximo «Guardar»
   * la daría por cambiada desde fuera.
   */
  async function renombrar(nombre: string) {
    if (!renombrando) return;
    const { cartera } = renombrando;
    setRenombrando({ cartera, guardando: true, error: null });
    try {
      await persistirCartera(
        sourceKind,
        { ...cartera, name: nombre, updated_at: new Date().toISOString() },
        { expectedUpdatedAt: cartera.updated_at }
      );
      setRenombrando(null);
      setAviso(`${cartera.name} se llama ahora ${nombre}.`);
    } catch (causa) {
      setRenombrando({
        cartera,
        guardando: false,
        error:
          causa instanceof ConflictoAlGuardar
            ? `${causa.message} El nombre no ha cambiado: vuelve a cargar la lista y renómbrala otra vez.`
            : `No se ha podido renombrar ${cartera.name}. El nombre no ha cambiado: inténtalo de nuevo.`
      });
    }
  }

  const columnas: ColumnaDeTabla<FilaDeCartera>[] = [
    {
      id: "nombre",
      titulo: "Propuesta",
      encabezaFila: true,
      celda: ({ cartera, suma, auditoria }) => {
        const resumen = resumenDeAuditoria(suma, auditoria);
        const esLaAbierta = ciclo?.abierta?.portfolio_id === cartera.portfolio_id;
        return {
          texto: cartera.name,
          valor: cartera.name,
          /* Pulsar la fila es solo para el ratón: el nombre lleva a la radiografía también con el teclado. */
          nodo: (
            <>
              {activosLeidos ? (
                <button aria-label={`Ver la radiografía de ${cartera.name}`} className="enlace-a-ficha" onClick={() => setAbierta(cartera.portfolio_id)} type="button">
                  {cartera.name}
                </button>
              ) : (
                cartera.name
              )}
              {esLaAbierta ? (
                <>
                  {" "}
                  <Distintivo tono="marca">Abierta en Diseño</Distintivo>
                </>
              ) : null}
              <span className="tabla__apunte tabla__apunte--estrecho">{resumen}</span>
            </>
          )
        };
      }
    },
    {
      id: "posiciones",
      titulo: "Posiciones",
      cifra: true,
      celda: ({ cartera }) => ({ texto: String(cartera.positions.length), valor: cartera.positions.length })
    },
    {
      id: "capital",
      titulo: "Capital",
      cifra: true,
      celda: ({ cartera }) => {
        const texto = importe(cartera.total_capital);
        return texto !== null && typeof cartera.total_capital === "number"
          ? { texto, valor: cartera.total_capital }
          : { texto: "Sin fijar", ausencia: "no-aplica" };
      }
    },
    /* Decisión 59: lo que el asesor ha definido, o que no lo ha hecho. «Sin definir» no es un dato que falte en
       una fuente: es una casilla que nadie ha rellenado, como el capital sin fijar. */
    {
      id: "perfil",
      titulo: "Perfil",
      celda: ({ cartera }) =>
        cartera.risk_profile_level === undefined
          ? { texto: SIN_DEFINIR, ausencia: "no-aplica" }
          : /* La cifra arriba y su nombre debajo, como el ISIN bajo un fondo: a 768 px la columna no le quita el sitio al nombre. */
            { texto: String(cartera.risk_profile_level), apunte: nombreDelNivel(cartera.risk_profile_level), valor: cartera.risk_profile_level }
    },
    {
      id: "horizonte",
      titulo: "Horizonte",
      cifra: true,
      celda: ({ cartera }) =>
        cartera.horizon_years === undefined
          ? { texto: SIN_DEFINIR, ausencia: "no-aplica" }
          : { texto: textoDelHorizonte(cartera.horizon_years), valor: cartera.horizon_years }
    },
    {
      id: "fecha",
      titulo: "Guardada",
      cifra: true,
      /* DIS-27: la fecha de pantalla, «21/10/2026», en la hora de quien mira. */
      celda: ({ cartera }) => {
        const texto = fecha(cartera.updated_at);
        return texto === null ? { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" } : { texto, valor: cartera.updated_at };
      }
    },
    { id: "suma", titulo: "Suman", cifra: true, soloAncho: true, celda: ({ suma }) => celdaDeSuma(suma) },
    { id: "fuera", titulo: "Fuera", tituloCompleto: "Posiciones fuera del catálogo", cifra: true, soloAncho: true, celda: ({ auditoria }) => celdaDeCatalogo(auditoria, activos.loading) },
    { id: "explica", titulo: "Sectores", tituloCompleto: "Sectores declarados de la renta variable", cifra: true, soloAncho: true, celda: ({ auditoria }) => celdaDeSectores(auditoria, activos.loading) },
    {
      id: "acciones",
      titulo: "Acciones",
      acciones: true,
      tituloOculto: true,
      celda: ({ cartera }) => {
        const esLaAbierta = ciclo?.abierta?.portfolio_id === cartera.portfolio_id;
        return {
          texto: "",
          nodo: (
            <span className="guardadas-acciones">
              <Button aria-label={`Abrir ${cartera.name} en Diseño de cartera`} onClick={() => abrir(cartera)} size="sm" variant="secondary">
                Abrir
              </Button>
              {/* A la vista, no en «Más» (Óscar, 16-11-2026: no lo encontraba). Discreto: la pregunta de antes es la que avisa. */}
              <Button
                aria-label={`Eliminar ${cartera.name}`}
                disabled={eliminando.has(cartera.portfolio_id)}
                onClick={() => void eliminar(cartera)}
                size="sm"
                variant="quiet"
              >
                Eliminar
              </Button>
              <MenuButton
                actions={[
                  {
                    id: "duplicar",
                    label: "Duplicar",
                    description: "Otra propuesta igual, «(copia)»; esta no cambia",
                    disabled: duplicando.has(cartera.portfolio_id),
                    onSelect: () => void duplicar(cartera)
                  },
                  {
                    id: "renombrar",
                    label: "Renombrar",
                    description: esLaAbierta ? "Está abierta en Diseño: cámbiale allí el nombre y guárdala" : "Cambia el nombre y nada más",
                    disabled: esLaAbierta,
                    onSelect: () => setRenombrando({ cartera, guardando: false, error: null })
                  }
                ]}
                label="Más"
                nombre={`Más acciones de ${cartera.name}`}
              />
            </span>
          )
        };
      }
    }
  ];

  const detalle = activosLeidos && abierta !== null ? saved.savedPortfolios.find((c) => c.portfolio_id === abierta) ?? null : null;

  /* La radiografía sale bajo la tabla: con dieciocho propuestas, fuera de la vista de quien la acaba de pedir. Al abrirse
     se desplaza a la vista y su título recibe el foco, para que el teclado y el lector de pantalla sigan ahí. */
  const seccionDeLaRadiografia = useRef<HTMLElement>(null);
  const tituloDeLaRadiografia = useRef<HTMLHeadingElement>(null);
  const hayDetalle = detalle !== null;
  useEffect(() => {
    if (abierta === null || !hayDetalle) return;
    /* Quien ha pedido «reducir movimiento» llega de golpe: el desplazamiento pedido desde código no pasa por la regla de las hojas. */
    const sinMovimiento = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    seccionDeLaRadiografia.current?.scrollIntoView?.({ block: "start", behavior: sinMovimiento ? "auto" : "smooth" });
    tituloDeLaRadiografia.current?.focus({ preventScroll: true });
  }, [abierta, hayDetalle]);

  const posiciones = todas.reduce((suma, fila) => suma + fila.cartera.positions.length, 0);
  const cuantas = `${todas.length} ${todas.length === 1 ? "propuesta" : "propuestas"}`;

  return (
    <div className="carteras">
      <PageHeader
        actions={
          <Button onClick={nuevaPropuesta} size="sm" variant="primary">
            Nueva propuesta
          </Button>
        }
        /* Cuántas hay va delante, como una frase: detrás, tras un punto medio, se quedaba colgando al final de la línea. */
        description={`${todas.length === 0 ? "" : `${cuantas}. `}${saved.enLaCuenta ? "Se guardan en tu cuenta: las ves con tu usuario desde cualquier ordenador." : "Se guardan en este navegador: solo las ves en este ordenador."}`}
        eyebrow="Propuestas"
        title="Propuestas guardadas"
      />

      <div className="stack">
        {aviso ? (
          <Aviso anunciar tono="nota">
            {aviso}
          </Aviso>
        ) : null}
        {saved.discardedCount > 0 ? (
          <Aviso anunciar>
            {textoDeLasQueNoSeLeen(saved.discardedCount, saved.enLaCuenta)}
          </Aviso>
        ) : null}

        {saved.errorAlListar ? <AsyncErrorBanner error={saved.errorAlListar} onRetry={saved.reintentar} /> : null}

        {saved.listando && todas.length === 0 ? (
          <>
            <LoadingState>Leyendo las propuestas…</LoadingState>
            <Esqueleto lineas={6} />
          </>
        ) : todas.length === 0 && !saved.errorAlListar ? (
          <EmptyState
            action={onIrA ? <Button onClick={() => onIrA("cartera")} variant="secondary">Ir a Diseño</Button> : undefined}
            description="Se guardan desde Diseño, con «Guardar»."
            nivel={2}
            title="Aún no has guardado ninguna propuesta"
          />
        ) : todas.length > 0 ? (
          <>
            {activos.error ? (
              <Aviso
                accion={
                  <Button onClick={activos.retry} size="sm" variant="secondary">
                    Reintentar
                  </Button>
                }
                anunciar
                titulo="No se ha podido leer el catálogo."
              >
                Falta lo que depende de él: si las posiciones están en el catálogo, los sectores declarados y la radiografía. Las propuestas se pueden abrir y eliminar igual.
              </Aviso>
            ) : null}
            <div className="carteras__lista">
              <Campo className="guardadas-buscar" rotulo="Buscar por nombre">
                <input onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Nombre de la propuesta" type="search" value={busqueda} />
              </Campo>
              {filas.length === 0 ? (
                <EmptyState
                  action={
                    <Button onClick={() => setBusqueda("")} variant="secondary">
                      Quitar la búsqueda
                    </Button>
                  }
                  description={`Ninguna de las ${cuantas} tiene «${busqueda.trim()}» en su nombre.`}
                  nivel={2}
                  title="Ninguna propuesta con ese nombre"
                />
              ) : (
                <TablaDeDatos
                  alAbrir={activosLeidos ? (fila) => setAbierta(fila.id) : undefined}
                  columnas={columnas}
                  deActivos
                  filas={filas}
                  porPagina
                  titulo="Propuestas guardadas"
                />
              )}
            </div>
            <p className="carteras__pie">
              {activosLeidos ? "Toca una propuesta para ver su radiografía. " : ""}
              {cuantas} · {posiciones} {posiciones === 1 ? "posición" : "posiciones"} en total. Cada una guarda su nombre,
              sus posiciones con sus pesos, su capital, y su perfil y horizonte si se han definido, no las fichas de los
              activos: al abrirla, las cifras salen de los datos de hoy.
            </p>
          </>
        ) : null}
      </div>

      {detalle && activosLeidos ? (
        <section aria-labelledby="carteras-radiografia-title" className="carteras__detalle" ref={seccionDeLaRadiografia}>
          <div className="carteras__detalle-cabecera">
            <h2 id="carteras-radiografia-title" ref={tituloDeLaRadiografia} tabIndex={-1}>
              {detalle.name}
            </h2>
            <Button onClick={() => setAbierta(null)} size="sm" variant="quiet">
              Cerrar
            </Button>
          </div>
          <RadiografiaDeLaCartera assets={activosLeidos} positions={detalle.positions} source={sourceKind} />
        </section>
      ) : null}
      {renombrando ? (
        <GuardarCarteraDialog
          avisoDeRepetido="Ya hay otra propuesta guardada con este nombre: las dos se llamarán igual."
          error={renombrando.error}
          guardando={renombrando.guardando}
          nombre={renombrando.cartera.name}
          nombresGuardados={saved.savedPortfolios.filter((c) => c.portfolio_id !== renombrando.cartera.portfolio_id).map((c) => c.name)}
          onCancelar={() => setRenombrando(null)}
          onGuardar={(nombre) => void renombrar(nombre)}
          rotuloDelBoton="Renombrar"
          titulo={`Renombrar ${renombrando.cartera.name}`}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
