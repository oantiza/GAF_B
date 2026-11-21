# Validación de «Mejorar cartera» con datos reales (pasada en seco)

**Fecha:** 13-10-2026
**Cómo:** `functions_python/scripts/dryrun_mejorar_cartera.py` sobre la copia local verificada `2026-10-13T11-37-00-001Z` (sin Firestore, sin despliegue). Ejecuta el mismo servicio que la callable `improve_portfolio` con un lector en memoria.
**Cartera:** nueve fondos reales, uno por categoría, elegido el de Sharpe mediano de su categoría para que haya margen de mejora y de empeoramiento. Cinco candidatos por posición, misma categoría, ordenados por Sharpe 3A. Ventana 3A, máximo 3 sustituciones.

| Peso | Fondo | Categoría |
|---|---|---|
| 15 % | Schroder ISF Global Equity Alpha B Acc EUR | Global Large-Cap Blend Equity |
| 12 % | Eleva European Selection A2 EUR acc | Europe Large-Cap Blend Equity |
| 13 % | MyInvestor S&P 500 Equiponderado FI | US Large-Cap Blend Equity |
| 8 % | Nordea 1 Emerging Sustainable Stars Equity BP EUR | Global Emerging Markets Equity |
| 7 % | Fidelity Global Technology E-Acc-EUR | Sector Equity Technology |
| 15 % | Morgan Stanley Euro Corporate Bond A | EUR Corporate Bond |
| 10 % | Mutuafondo Corto Plazo FI | EUR Ultra Short-Term Bond |
| 8 % | Principal Finisterre Unconstrained EM Fixed Income A Hdg Acc EUR | Global EM Bond EUR Hedged |
| 12 % | BlackRock ESG Multi-Asset E2 | EUR Moderate Allocation Global |

## Rendimiento del servicio

| Medida | Valor |
|---|---|
| Lectura de la copia (1.091 raíces) | 5,9 s, una sola vez |
| Evaluación completa (carga de 54 series + búsqueda + validación) | 1,3 a 1,4 s |
| Lecturas de activos y series | 106 |
| Ventana común | 09-10-2023 a 05-10-2026, 156 semanas |

Un cálculo en producción cabe de sobra en los 300 s de la callable; el coste de lecturas es del orden de dos por activo.

## Primera pasada: umbrales iniciales del plan

Con correlación mínima 0,85 (RV) / 0,75 (RF y mixtos) y tracking error máximo 4 % / 2 % / 3 %, **39 de 45 candidatos quedaron descartados por series** y el resultado fue «sin mejora». Lo que enseñó:

- Dos fondos activos de la misma categoría de renta variable correlacionan entre 0,78 y 0,84 y tienen 5-7 % de tracking error entre sí. El umbral 0,85 / 4 % solo admite fondos casi indexados.
- En renta fija a muy corto plazo (casi monetarios) la correlación semanal es 0,4-0,65 aunque los fondos sean intercambiables: la volatilidad es tan baja que el coeficiente no mide nada.
- La mejor combinación en selección falló en confirmación (consistencia y mejora relevante): la validación fuera de muestra hace su trabajo.

## Segunda pasada: umbrales recalibrados (los que quedan por defecto)

| Clase del original | Correlación mínima | Tracking error máximo |
|---|---|---|
| Renta variable | 0,75 | 8 % |
| Renta fija | 0,60 | 4 % |
| Mixtos | 0,65 | 6 % |
| Monetario | no se exige | 1,5 % |
| Original con volatilidad anual < 2 % | no se exige | el de su clase |

Resultado: **propuesta válida** con tres sustituciones, encontrada por búsqueda por pasos (61 combinaciones evaluadas).

| | Cartera actual (confirmación) | Propuesta (confirmación) |
|---|---|---|
| Rentabilidad anualizada | 12,26 % | 15,79 % |
| Volatilidad anual | 8,13 % | 7,55 % |
| Sharpe | 1,27 | 1,84 |
| Máxima caída | −5,80 % | −5,58 % |
| Coste corriente ponderado | 1,60 % | 1,32 % |

Sustituciones: BlackRock ESG Multi-Asset → Aegon Global Diversified Income (corr. 0,78, TE 5,1 %); Schroder Global Equity Alpha → DWS Invest II Global Equity High Conviction (0,82, 7,9 %); Eleva European Selection → Wellington Strategic European Equity (0,86, 7,1 %). Todas pasan las puertas de selección y confirmación, el coste y la consistencia en ventanas móviles.

## Conclusiones para el plan

1. El motor y el servicio funcionan de extremo a extremo con la maestra real y en tiempo de interfaz.
2. Los umbrales de la capa de series del borrador eran teóricos; los recalibrados quedan como valores por defecto en `improvement_engine.DEFAULT_THRESHOLDS` y la pantalla permite endurecerlos.
3. Las sustituciones propuestas son fondos activos de la misma categoría con comportamiento parecido, no clones: la ficha de equivalencia de la pantalla (etiquetas, exposiciones, veredicto) sigue siendo imprescindible para que el asesor juzgue cada cambio.
4. Pendiente de verdad: repetir con la cartera real de nueve fondos del cliente, con la fuente en vivo y la callable desplegada.
