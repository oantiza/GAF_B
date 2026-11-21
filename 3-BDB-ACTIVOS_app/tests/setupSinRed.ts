/**
 * Ninguna prueba sale a la red.
 *
 * El 14-11-2026 la suite entera hacía 26 llamadas de verdad a los emuladores locales —17 a `get_price_series`, una a
 * `backtest_portfolio` y ocho lecturas de `instruments/…/read/card`— desde pruebas de pantalla que montaban una pieza
 * sin darle un doble a todo lo que pide. Pasaban igual, porque la respuesta era un 401 o un 404 y la pantalla lo
 * trataba como un fallo de carga, pero dependían de qué hubiera levantado en el equipo y tocaban emuladores que
 * comparten otras sesiones.
 *
 * Aquí `fetch` falla en el acto, diciendo a quién se llamaba: la prueba ve el mismo fallo de carga, sin salir del
 * proceso, y quien la escribe sabe qué doble le falta. Quien necesita la red de verdad lo pide: las pruebas contra
 * los emuladores se lanzan con `BDB_TEST_EMULATORS=1`, y una prueba suelta puede poner su propio `fetch` con
 * `vi.stubGlobal`.
 */
const fetchDeVerdad = globalThis.fetch;

function direccionDe(entrada: unknown): string {
  if (typeof entrada === "string") return entrada;
  if (entrada instanceof URL) return entrada.href;
  return typeof (entrada as { url?: unknown })?.url === "string" ? (entrada as { url: string }).url : String(entrada);
}

if (process.env.BDB_TEST_EMULATORS !== "1" && typeof fetchDeVerdad === "function") {
  globalThis.fetch = ((entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const direccion = direccionDe(entrada);
    /* Lo que no es red: un dato incrustado o un objeto en memoria. */
    if (/^(data|blob):/i.test(direccion)) return fetchDeVerdad(entrada, opciones);
    return Promise.reject(new TypeError(`Las pruebas no salen a la red: falta un doble para ${direccion}`));
  }) as typeof fetch;
}
