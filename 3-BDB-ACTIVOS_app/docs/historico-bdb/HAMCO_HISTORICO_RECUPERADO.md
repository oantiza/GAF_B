> **Histórico de BDB: no se ejecuta.** El programa que describe se retiró el 05-11-2026 (decisión 106) y sigue en el historial de Git: solo servía contra la maestra de BDB. Se conserva como registro de cómo se recuperaron esos cinco valores, con su evidencia al lado.

# Recuperación del histórico de Hamco R

## Alcance

HAMCO GLOBAL VALUE FUND, FI clase R (`ES0141116030`) fue absorbido por
HAMCO SICAV – GLOBAL VALUE FUND R EUR (`LU3038481936`), con efecto el
25/11/2025. Fuentes: [BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-B-2025-35041),
[gestora](https://www.hamco.es/2025/11/26/hamco-fusion-global-value-fund-sicav-isin/) y
[cuentas auditadas, nota 8](https://info.hamco.es/hubfs/Web%20Publica%20Hamco/Generales/Cuentas-Anuales-Hamco-SICAV.pdf).

La maestra ya conservaba 1.528 cotizaciones desde diciembre de 2019, con
metadatos de continuidad del ISIN anterior. No hacía falta un proxy ni asumir
un canje 1:1. Faltaban anclajes reales en abril y septiembre de 2022, por lo que
tres fechas de la rejilla de cinco años excedían el límite de siete días desde
la última cotización: 06/05, 09/09 y 12/09 de 2022.

## Evidencia y reparación

La [serie publicada por Hamco](https://www.hamco.es/fondo-global-value-fund/)
incluye cinco observaciones ausentes en esos dos huecos. Se contrastan con
boletines oficiales de BME para la misma clase R:

| Fecha del VL | VL EUR | Boletín BME |
| --- | ---: | --- |
| 29/04/2022 | 178,6259 | Valencia, 09/05/2022, p. 12 |
| 02/09/2022 | 188,2457 | Valencia, 05/09/2022, p. 12 |
| 06/09/2022 | 188,3549 | Valencia, 07/09/2022, p. 12 |
| 07/09/2022 | 188,5858 | Bilbao, 09/09/2022, p. 12, columna precedente |
| 08/09/2022 | 188,8420 | Bilbao, 09/09/2022, p. 12 |

Para el 07/09, la fecha procede explícitamente del array diario de la gestora
(188,59 EUR redondeados); BME aporta los cuatro decimales como VL precedente
al del 08/09. Los demás usan la columna «Último» con su fecha, nunca la fecha
de publicación del boletín. Los enlaces precisos y este matiz quedan en
`hamco_nav_recovery_2022.json`, en esta misma carpeta.

Los boletines se contrastaron mediante el texto público indexado; las URL
antiguas de BME redirigen actualmente a su portada, por lo que no se certifica
una inspección visual del PDF original. Las cinco observaciones también están
en el HTML de la gestora. Dos discrepancias fuera de estos huecos
(11/11 y 05/12/2022) entre su gráfico redondeado y el proveedor quedan fuera
de esta reparación; no se sustituye el año completo por el gráfico.

`scripts/repair_hamco_history.py` solo permite este activo, documento, clase y
cinco fechas. Inserta los VL conservando todos los puntos y metadatos previos,
documenta la fuente mixta en `metadata.nav_gap_repair`, recalcula las métricas
y elimina el estado incremental de drawdown para reconstruirlo con la serie
reparada. No modifica el valor liquidativo actual ni ningún otro activo.

El modo predeterminado es solo lectura. La aplicación exige el gate habitual
(`BDB_ACTIVOS_ENABLE_MASTER_WRITES`, comprobado también en la propia línea de
comandos desde el 29-09) y `--project bbdd-activos-financieros` explícito, que
debe coincidir con el proyecto de las credenciales ADC; además una copia durable del estado anterior y una transacción que vuelve a leer
todas las series, raíz y métricas. Cualquier cambio concurrente cancela el plan.
Máximo: un documento de precios, uno de métricas y un estado incremental.

## Verificación

Aplicado el 06/09/2026 a las 19:29:59 UTC (21:29:59 Madrid): cinco puntos,
199 → 204 observaciones en 2022 y 1.528 → 1.533 en toda la serie.
Tres escrituras atómicas: precios 2022, métricas y eliminación del estado
incremental anterior. Lectura posterior idéntica al plan. Segunda ejecución
en modo lectura: `NO_CHANGE`, cero escrituras.

Diez pruebas de regresión pasan: los tres huecos reales, conservación de
cotizaciones, idempotencia, identidad de clase, divisa, bloqueo de calidad,
conflictos y cambios concurrentes. Validación contra el contrato v1.2.

Comprobación de GORKA con el motor publicado y lecturas de la maestra:

| Periodo | Activos incluidos | Peso cubierto | CAGR | Volatilidad | Sharpe | Máx. caída |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3A | 38/39 | 99,2278 % | 14,9199 % | 8,5622 % | 1,4136 | −10,7369 % |
| 5A | 38/39 | 99,2278 % | 9,9556 % | 9,1434 % | 0,8659 | −13,2594 % |

Hamco entra en ambos periodos sin extensión estimada. A 3A, serie y métricas
son exactamente iguales a las anteriores. A 5A pasa de 37 a 38 activos.
La única exclusión es TSK por calidad del dato. Se obtienen 33 puntos de
frontera a 3A y 34 a 5A; el optimizador utiliza su fallback existente para
CLA degenerada. No se altera ese algoritmo.

Dos PDF de comprobación, generados con las 39 fichas leídas de la maestra y
el generador vigente: 10 páginas cada uno, pies consecutivos, métricas,
frontera y Monte Carlo al mismo horizonte. Revisión visual de las páginas
de análisis avanzado a 3A y 5A y de métricas a 5A. Hamco no figura como
excluido ni como proxy en sus anexos.

Verificación autenticada adicional en la web publicada, desde Chrome:
GORKA cargada desde las nueve carteras guardadas. En «Simular», ambos
periodos muestran 38 activos y 99,2 % de cobertura; la única exclusión
visible es TSK. Backtest, métricas, drawdown, Monte Carlo y frontera cambian
juntos entre 3A y 5A. El informe de cliente conserva el selector y las cifras.
Se descargan los dos PDF consecutivamente desde esa misma sesión, sin
recargar entre documentos, para comprobar también el recorrido publicado.
Ambos tienen diez páginas: 112.120 bytes a 3A y 124.003 bytes a 5A. Se leen
sus métricas y anexos y se renderiza la página de frontera y Monte Carlo
en cada uno. Coinciden con pantalla; Hamco está incluido y solo TSK queda
fuera. Los importes de la proyección usan únicamente el capital cubierto.

Artefactos locales, fuera del repositorio: `tmp/hamco-repair/preview.json`,
`applied.before.json`, `applied.json`, `idempotent-preview.json`,
`dry-run-validation.json` y `acceptance/` en el workspace de la tarea.
SHA-256 del estado anterior: `f5082953da49c8bb6b949c6d40e0752e5b0a78ab5db3b36f588af33683b436b4`.
SHA-256 del estado posterior: `72108cc9cd04173bf0f4b15bedb83419e696c7a23347ea28d5ee15c18c6dba60`.

El límite de antigüedad de siete días y los ficheros protegidos de Claude no
se modifican. Las instancias publicadas recargan el histórico como máximo al
vencer la caché de precios de 15 minutos; la corrección de datos no requiere
publicar otra versión del programa.
