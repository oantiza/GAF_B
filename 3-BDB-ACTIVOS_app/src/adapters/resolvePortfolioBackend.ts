/**
 * Resolución por lotes de una cartera de importes contra la maestra (Extracto
 * externo, Posiciones globales).
 *
 * MEDIA-11 (auditoría 14-10-2026): este módulo tenía su propia copia de
 * `resolve_portfolio` (llamada, lotes, mapeo de filas y casado por id) y el
 * adaptador en vivo otra; ya divergían (la del adaptador no casaba los ISIN
 * sustituidos, CRIT-02.3). Ahora solo hay una implementación, la del adaptador,
 * y aquí se reexpone con el nombre que usan las pantallas de posiciones.
 */
export { resolveLiveApiPortfolioPositions as resolvePortfolioBatch } from "./bdbLiveApiAdapter";
