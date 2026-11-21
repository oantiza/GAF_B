# Cierre de la tercera revisión de divisas

6 de septiembre de 2026. Estado al emitir este informe: cambios locales sobre `0dea2b4`, todavía sin publicar.

> **Cierre posterior:** estos cambios están comiteados y publicados en `4980264`. Se han reparado y verificado los nueve activos del alcance ampliado. Véanse la copia, el despliegue y las comprobaciones reales en [el cierre de producción](docs/CORRECCION_AJUSTES_HISTORICOS_2026-09-06.md). El texto siguiente conserva el diagnóstico y el estado de aquella revisión.

Responde a los tres puntos de `REVISION_TERCERA_CORRECCION_DIVISAS_20260906.md` (Astra) y a la instrucción acordada: *conservar los importes del extracto y dejar N/D las métricas que dependan de precios en cuarentena hasta repararlos*.

---

## 1. El análisis parcial fabricaba una caída del 50 % — retirado

El intento anterior sacaba el activo en cuarentena de la lista de precios requeridos pero conservaba su posición, sus movimientos y el valor final del extracto. La serie perdía esa posición en las fechas intermedias y la recuperaba al final: una caída y una recuperación que nunca ocurrieron.

**Se ha retirado el cálculo parcial.** La regla ahora es una sola:

| | Antes (parcial) | Ahora |
|---|---|---|
| Estado del motor | `ready_partial_quarantine` (inventado) | `blocked_by_coverage` (contrato existente) |
| Importes del extracto | se conservaban | **se conservan** (valor, coste, plusvalía, dividendos, comisiones, caja, patrimonio) |
| Métricas temporales | se publicaban con la posición ausente | **N/D, con el motivo dicho y el ISIN nombrado** |
| Máxima caída | −50 % ficticia | N/D |
| Cobertura | «parcial» | no completa; el activo consta como **bloqueante** |

`FX_QUARANTINE` vuelve a marcarse como bloqueante (`blocking: true`). Solo la exclusión declarada por el titular —sin posición viva que valorar— deja de bloquear.

El mensaje que llega a pantalla e informe:

> Precios en cuarentena por un error de divisa conocido (IE000M7V94E1): los importes del extracto se conservan y las métricas que dependen del histórico quedan pendientes hasta reparar y verificar esas series.

Si además faltan series por otra causa, los dos motivos se concatenan; antes el de cuarentena pisaba al general.

### Prueba de coherencia numérica

`test_la_cuarentena_no_publica_una_caida_inventada` reproduce la comparación de Astra con la misma cartera sintética de dos posiciones y un traspaso, cambiando solo el ISIN de destino por uno en cuarentena:

- **Control**: `ready_for_engine`, TWR 20 %, máxima caída 0 %.
- **Variante en cuarentena**: valor de mercado, caja, flujos externos y patrimonio **idénticos al control**; TIR, TWR, TWR anualizada, retornos móviles, año natural, volatilidad, Sharpe, Sortino, Calmar y máxima caída **todos N/D**; fechas de suelo y duración **nulas**.

No comprueba solo el estado y los mensajes: comprueba que **no aparece ninguna caída**.

## 2. La interfaz ya no tiene que aceptar un estado nuevo

Al volver a `blocked_by_coverage`, el contrato del adaptador queda intacto. Se ha comprobado con una respuesta real atravesando el adaptador (`test`: acepta el estado, conserva el motivo entero con el ISIN, mantiene los importes del extracto y el activo apartado con su acción y su marca de bloqueante).

**Pantalla**: ya mostraba `xirr.reason` y `max_drawdown.reason`, así que el motivo se lee sin cambios. Se han añadido etiquetas para que la cobertura no lea «Fx quarantine»: *Precios en cuarentena por divisa*, *Exclusión declarada por el titular*, *Sin serie de precios en la maestra*, y las tres restantes.

**Informe PDF**: aquí había un hueco real, anterior a la cuarentena. Con las métricas bloqueadas el informe imprimía N/D en todo **sin decir por qué**, describía «Máxima caída desde N/D hasta N/D, duración N/D días» y seguía dibujando una curva comparativa vacía. Corregido:

- aviso **«Métricas temporales pendientes»** con el motivo y la aclaración de que los importes del extracto son exactos;
- la lectura de riesgo dice **«Máxima caída no disponible»** con su motivo, en vez de describir una caída inexistente;
- la comparativa contra referencias se omite explicando por qué, en vez de dibujar una curva vacía.

Verificado leyendo el PDF generado (`tests/realPortfolioQuarantineReport.test.tsx`, 4 pruebas): el texto contiene el aviso, la palabra «cuarentena», el ISIN, «Máxima caída no disponible» y «Comparativa temporal pendiente»; **no** contiene «Máxima caída desde». El control con caída real sigue describiéndola con sus fechas y duración. El plan de hojas no cambia.

## 3. El verificador comparte ya la resolución de divisa

La corrección se había escrito solo en el productor. El verificador seguía con la consulta antigua: aceptaba `NA` como divisa, la cacheaba, y presentaba ese fallo propio como «sin precios del proveedor con los que contrastar» —culpando al proveedor—.

- Nuevo módulo **`functions_python/fx_currency.py`**: la regla vive en un sitio. Fundamentales primero; si no dan una divisa válida, **búsqueda exacta por símbolo y bolsa**. Sin dependencias de Firebase ni de red (el lector HTTP se inyecta), así que se puede probar sin proveedor. Devuelve `(divisa, motivo)` y **nunca** un valor por defecto.
- `price_refresh.listing_currency` delega en él; el mapa de subunidades (GBX/ILA/ZAC) también pasa a ser el compartido, para que la escala no divirja. `history_backfill` e `ingest_asset` ya pasaban por `listing_currency`.
- El verificador usa el mismo módulo. Su caché pasa a estar **versionada**: las entradas escritas por la resolución antigua (`NA`, `null`) se **descartan y se vuelven a resolver**, y se cuenta cuántas (`cache_divisas_revalidadas`). Un mapa precargado con `NA` tampoco exime de resolver.
- **«No verificado» ya dice por qué.** Causas separadas y contadas: `SIN_SIMBOLO`, `SIN_DIVISA`, `DIVISA_NO_VALIDA`, `SIN_FX`, `SIN_COTIZACION`, `SIN_PUNTOS`, `SIN_METADATOS`. Antes «sin cotización» y «sin tipo de cambio» se contaban juntas bajo un texto que echaba la culpa al proveedor.
- `--assets-file` para pasar listas largas (660 ISIN no caben en la línea de comandos de Windows).

## Estado de las pruebas

| Suite | Contenedor | PC (con fixtures privados) |
|---|---:|---:|
| Python | 397 pasan, 5 omitidas | **402 pasan** |
| TypeScript | 726 pasan, 2 omitidas | **726 pasan, 2 omitidas** |
| `tsc --noEmit` | limpio | limpio |

Nuevas: 1 de coherencia numérica de la cuarentena, 1 de contrato del adaptador, 4 del informe PDF, 6 del verificador y su caché, 1 de causas separadas.

## Lo que sigue pendiente

1. **Reclasificar el barrido con el verificador corregido.** El barrido anterior (1.012 activos, 1.986 documentos muestreados) dio 620 OK, 57 hallazgos y **1.309 no verificados**, de los cuales 1.296 se atribuyeron a «sin precios del proveedor». Esa cifra no es fiable: se midió con la resolución antigua. Re-contraste en marcha sobre los 660 activos afectados.
2. **Clasificar los 57 hallazgos.** 55 son `ERROR_DISCREPANCIA` concentrados en renta variable española (`ES01…`), lo que apunta a ajuste por dividendos (`adjusted_close` frente a cierre guardado) más que a divisa; 1 error de escala y 1 sin convertir. Hay que separarlos antes de tocar dato alguno.
3. **Completar el inventario de reparación**: 52 documentos de los 6 ETF + 29 de HSBC + lo que añada el barrido reclasificado.
4. **Fase 2** (reparar con la puerta de escritura en maestra, primero en seco), **fase 3** (recalcular métricas) y solo entonces **retirar entradas de la cuarentena**.
5. Sin empezar: **B2** (`fund_ingest.py:31` apunta a `tools.morningstar.es`, NXDOMAIN), resto de la ola 2, olas 3 y 4.

## Ficheros tocados

```
functions_python/fx_currency.py                        (nuevo)
functions_python/price_refresh.py
functions_python/portfolio_real/service.py
functions_python/tests/test_portfolio_real.py
functions_python/tests/test_verify_price_currency.py
scripts/verify_price_currency.py
src/reports/realPortfolioPdf.tsx
src/adapters/realPortfolioBackend.ts
src/core/labels.ts
tests/fixtures/realPortfolio.ts
tests/realPortfolioBackend.test.ts
tests/realPortfolioQuarantineReport.test.tsx           (nuevo)
CIERRE_REVISION3_DIVISAS_2026-09-06.md                 (este documento)
```
