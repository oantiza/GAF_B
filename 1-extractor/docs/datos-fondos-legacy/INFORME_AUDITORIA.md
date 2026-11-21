# Auditoría de la base de fondos — 11-06-2026

**Estado:** 499 ISINs configurados · **321 con JSON completo** · 178 pendientes de actualizar (deja correr otro `update --all` para completarlos) · 0 ficheros ilegibles.

## Cobertura general (sobre los 321)

Excelente en todo lo transversal: rentabilidades 1a **100%**, TER 99%, volatilidad y Sharpe 3a 99%, SRI **100%**, patrimonio y gestora 100%, estrellas 93%, Medalist 91%, ESG 95%, costes MiFID 97%, posiciones de cartera 320/321 (mediana 56 posiciones por fondo). Campos por fondo: mediana 877, hasta 80.148 (ETFs con cartera completa).

Flojos esperables: el ETC de oro (112) y fondos monetarios/garantizados pequeños (~260-310), donde simplemente hay menos que contar.

## Renta fija (prioridad 1-16) — 70 fondos RF + 31 mixtos detectados

| Métrica | Cobertura RF | Diagnóstico |
|---|---|---|
| Duración efectiva | 44/70 (63%) | Los 26 sin dato **no lo tienen en Morningstar** (revisados sus crudos: solo 1 traía analítica). No es fallo de mapeo: son fondos pequeños (españoles sobre todo) para los que Morningstar no calcula analítica de cartera |
| YTM | 45/70 (64%) | Ídem |
| Calidad crediticia (desglose) | 48/70 (69%) | Ídem (0 de los 22 huecos tienen dato en crudo) |
| **% soberana/corporativa/titulizada** | **70/70 disponible** | `GlobalBondSectorBreakdownLevel1` está en TODOS los crudos MFsnapshot de RF — pendiente solo de mapear (códigos 10=gobierno, 30=corporativa, 40=titulizada, 50=liquidez) |
| Modified duration | ~9 con dato en crudo | Pendiente de mapear (1 línea); cobertura limitada por Morningstar |
| Cupón medio / precio medio | 23/25 en crudos | Pendiente de mapear; cobertura alta |

## Acciones que desbloquearían datos YA descargados (solo mapeo, sin red)

1. % deuda pública / corporativa / titulizada / liquidez para los 70 RF y 31 mixtos (ítems 9-10).
2. Modified duration, cupón medio, precio medio (ítems 2, 16 parcial).
3. % investment grade y % high yield: cálculo derivado de la calidad ya mapeada (ítems 7-8).
4. Fechas de costes y riesgo (ítems 27, 29) — están en los crudos Mifid/RiskStatistics.

## Acciones que requieren descarga adicional

5. Tramos de vencimiento (ítem 14): añadir bloque `maturitySchedule` de sal-service.
6. Yield to worst (ítem 4): añadir bloque `multiLevelFixedIncomeData`. Cobertura esperada: solo los ~44 con analítica.
7. Divisa de exposición RF (ítem 12): agregación por posición (ya viene divisa por posición en sal y CNMV).

## Los huecos reales (Morningstar no los tiene)

Los ~26 fondos RF sin analítica (Gesconsult, Trea, Merch, SIH, horizontes...) solo podrán completarse con: **(a)** el trimestral CNMV cuando se publique (cartera oficial completa), y **(b)** extracción de sus factsheets/PDF de gestora, donde las gestoras españolas sí suelen publicar duración y TIR. Spread duration (ítem 15) no existe en ninguna fuente gratuita.

## Otras incidencias

- `ES0141116030` sin identificar (sin nombre): revisa el ISIN — puede estar dado de baja o ser clase no comercializada.
- 178 pendientes: relanza `Actualizar todo` (la caché hace que los 321 ya hechos pasen volando).
