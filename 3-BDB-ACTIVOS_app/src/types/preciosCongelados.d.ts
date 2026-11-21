/** Lo que `vite.config.ts` saca de `functions_python/fund_history_policies.json`: las entradas con `PRICE_FROZEN_DELISTED`. */
declare module "virtual:precios-congelados" {
  const congelados: Readonly<Record<string, { desde: string | null; valor: number | null }>>;
  export default congelados;
}
