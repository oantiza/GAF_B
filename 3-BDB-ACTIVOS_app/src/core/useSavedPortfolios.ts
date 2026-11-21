import { useEffect, useMemo, useRef, useState } from "react";
import {
  backendDeletePortfolio,
  backendListPortfolioResult,
  usesBackendPersistence
} from "../adapters/portfolioBackend";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbSavedLocalPortfolio
} from "../types/bdbAssets";
import { appLogger } from "./appLogger";
import { avisarCarterasGuardadas, escucharCarterasGuardadas } from "./carterasGuardadasAvisos";
import { getBrowserLocalStorage } from "./draftStorage";
import { guardarCartera } from "./guardarCartera";
import {
  deleteLocalPortfolio,
  loadLocalPortfolio,
  saveLocalPortfolio
} from "./portfolio";
import { carterasQueNoSeLeen, readLocalPortfoliosFromStorage, writeLocalPortfoliosToStorage } from "./localPortfolioStorage";
import type { PerfilYHorizonte } from "./perfilYHorizonte";

interface UseSavedPortfoliosOptions {
  sourceKind: AssetDataSourceKind;
  /** Se llama al cargar una cartera guardada, con posiciones y capital ya saneados. Lo necesita quien abre carteras. */
  onLoad?: (
    positions: BdbManualPortfolioPosition[],
    totalCapital: number | undefined,
    name: string,
    portfolio: BdbSavedLocalPortfolio
  ) => void;
  /** Avisos hacia el usuario («guardada», «eliminada», fallos…). `null` quita el que hubiera. */
  onNotice: (message: string | null) => void;
}

/**
 * Carteras guardadas (cuenta o navegador según la fuente activa). Extraído
 * de AssetSearch con el router de la ola 3b: este estado solo lo necesita el
 * Constructor, así que la llamada `list_portfolios` solo se paga al montarlo
 * — antes se disparaba en cualquier ruta del embudo (F2.9).
 */
export function useSavedPortfolios({ sourceKind, onLoad, onNotice }: UseSavedPortfoliosOptions) {
  const usingBackendPortfolios = usesBackendPersistence(sourceKind);
  const [savedPortfolios, setSavedPortfolios] = useState<BdbSavedLocalPortfolio[]>(() =>
    usingBackendPortfolios ? [] : readLocalPortfoliosFromStorage(getBrowserLocalStorage())
  );
  /* H04 (auditoría 14-10-2026): carteras de la cuenta que no cumplen el contrato.
     Se descartan una a una (el resto se carga) y la lista lo dice. */
  const [discardedCount, setDiscardedCount] = useState(0);
  const avisoDeFalloAlListar = useRef(false);
  /* Una lista vacía y una que aún no ha llegado, o que ha fallado, no se dicen igual. */
  const [listando, setListando] = useState(usingBackendPortfolios);
  const [errorAlListar, setErrorAlListar] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);
  const mutationRevision = useRef(0);

  useEffect(() => {
    if (!usingBackendPortfolios) {
      return;
    }
    let isActive = true;
    const revision = mutationRevision.current;
    setListando(true);
    setErrorAlListar(null);
    backendListPortfolioResult()
      .then((result) => {
        if (isActive && revision === mutationRevision.current) {
          setSavedPortfolios(result.portfolios);
          setDiscardedCount(result.discarded.length);
        }
        if (isActive) {
          setListando(false);
          /* El aviso del fallo anterior ya no es cierto: la lista ha cargado. */
          if (avisoDeFalloAlListar.current) onNotice(null);
          avisoDeFalloAlListar.current = false;
        }
      })
      .catch((cause: unknown) => {
        appLogger.warn("carteras guardadas: fallo al listar desde la cuenta", cause);
        if (isActive) {
          setListando(false);
          setErrorAlListar(cause);
          avisoDeFalloAlListar.current = true;
          onNotice("No se pudieron cargar las carteras guardadas de tu cuenta.");
        }
      });
    return () => {
      isActive = false;
    };
    // onNotice es estable en la práctica; si no lo fuera, re-listar sería inocuo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingBackendPortfolios, intento]);

  useEffect(() => {
    if (usingBackendPortfolios) {
      return;
    }
    setSavedPortfolios(readLocalPortfoliosFromStorage(getBrowserLocalStorage()));
  }, [usingBackendPortfolios]);

  /* La lista se entera de lo que cambia, lo haya pedido quien lo haya pedido: el aviso de cambios sin
     guardar guarda desde el marco, sin pasar por este estado. Una lista que llegue tarde no lo pisa. */
  useEffect(
    () =>
      escucharCarterasGuardadas((aviso) => {
        mutationRevision.current += 1;
        setSavedPortfolios((actuales) =>
          aviso.tipo === "guardada"
            ? saveLocalPortfolio(deleteLocalPortfolio(actuales, aviso.cartera.portfolio_id), aviso.cartera)
            : deleteLocalPortfolio(actuales, aviso.id)
        );
      }),
    []
  );

  /*
   * IMP-9 (17-11-2026): las guardadas en este navegador que no se pueden leer no salen en la lista, pero siguen en el almacén (guardar otra ya no las
   * borra). Se cuentan para decirlo. Se vuelven a contar cada vez que la lista cambia: guardar, eliminar o recargar.
   */
  const sinLeerEnElNavegador = useMemo(
    () => (usingBackendPortfolios ? 0 : carterasQueNoSeLeen(getBrowserLocalStorage()).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usingBackendPortfolios, savedPortfolios]
  );

  const visibleSavedPortfolios = useMemo(
    () =>
      savedPortfolios
        .slice()
        .sort((a, b) => {
          if (a.sourceKind === sourceKind && b.sourceKind !== sourceKind) {
            return -1;
          }
          if (a.sourceKind !== sourceKind && b.sourceKind === sourceKind) {
            return 1;
          }
          return b.updated_at.localeCompare(a.updated_at);
        }),
    [savedPortfolios, sourceKind]
  );

  /**
   * «Guardar como propuesta»: siempre otra cartera. La abierta la guarda el marco. Con `perfilYHorizonte`,
   * los de la cartera de origen (decisión 59); sin él, la nueva no lleva ninguno.
   */
  async function save(
    name: string,
    positions: BdbManualPortfolioPosition[],
    assets: BdbAssetDetail[],
    totalCapital: number | undefined,
    perfilYHorizonte?: PerfilYHorizonte
  ) {
    if (usingBackendPortfolios) {
      onNotice(`Guardando ${name} en tu cuenta…`);
    }
    const resultado = await guardarCartera({ sourceKind, nombre: name, positions, capital: totalCapital, assets, perfilYHorizonte });
    onNotice(resultado.mensaje);
  }

  function load(portfolio: BdbSavedLocalPortfolio) {
    onLoad?.(
      loadLocalPortfolio(portfolio),
      // F-04: una cartera guardada sin capital se carga sin capital (no 100.000 €).
      typeof portfolio.total_capital === "number" && Number.isFinite(portfolio.total_capital)
        ? Math.max(0, portfolio.total_capital)
        : undefined,
      portfolio.name,
      portfolio
    );
    onNotice(`${portfolio.name} cargada.`);
  }

  async function remove(portfolioId: string) {
    const portfolio = savedPortfolios.find((candidate) => candidate.portfolio_id === portfolioId);

    if (usingBackendPortfolios) {
      onNotice(portfolio ? `Eliminando ${portfolio.name}…` : "Eliminando cartera…");
      try {
        const result = await backendDeletePortfolio(portfolioId);
        avisarCarterasGuardadas({ tipo: "eliminada", id: portfolioId });
        onNotice(
          result.ok
            ? portfolio ? `${portfolio.name} eliminada de tu cuenta.` : "Cartera eliminada."
            : portfolio ? `${portfolio.name} ya no existía en tu cuenta; se ha retirado de la lista.` : "La cartera ya no existía."
        );
      } catch (cause) {
        appLogger.warn("carteras guardadas: fallo al eliminar de la cuenta", cause);
        onNotice(
          portfolio ? `No se pudo eliminar ${portfolio.name}; permanece en tu cuenta.` : "No se pudo eliminar la cartera."
        );
      }
      return;
    }

    const almacen = getBrowserLocalStorage();
    writeLocalPortfoliosToStorage(almacen, deleteLocalPortfolio(readLocalPortfoliosFromStorage(almacen), portfolioId));
    avisarCarterasGuardadas({ tipo: "eliminada", id: portfolioId });
    onNotice(portfolio ? `${portfolio.name} eliminada de este navegador.` : "Cartera eliminada de este navegador.");
  }

  return {
    savedPortfolios: visibleSavedPortfolios,
    /* Las que no se pueden leer: en la cuenta, las que el servidor descartó; en el navegador, las que siguen guardadas sin poder abrirse. */
    discardedCount: usingBackendPortfolios ? discardedCount : sinLeerEnElNavegador,
    /** Si se guardan en la cuenta del asesor o solo en este navegador. */
    enLaCuenta: usingBackendPortfolios,
    listando: usingBackendPortfolios && listando,
    errorAlListar: usingBackendPortfolios ? errorAlListar : null,
    reintentar: () => setIntento((actual) => actual + 1),
    save,
    load,
    remove
  };
}
