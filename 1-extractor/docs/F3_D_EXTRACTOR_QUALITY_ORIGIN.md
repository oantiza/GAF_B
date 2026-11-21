# F3-D extractor y calidad de origen

Fecha: 2026-07-02

## C-02 region_primary nula

Medicion previa sobre `data/funds`: 125/752 nulos, 16.62%.

Diagnostico: todos los nulos vienen de `ms.regions.detail` vacio en el canonico, no de umbral. El caso dominante son categorias de renta fija, monetarios y materias primas donde Morningstar no entrega `RegionalExposure`.

Cambio aplicado: `classification_v2.region_primary` usa fallback en este orden:

1. reglas existentes por categoria y exposicion regional fuerte;
2. mayor region de `equity_regions`/`ms.regions.detail` si existe;
3. region inferida por categoria Morningstar.

Cuando se aplica fallback se marca `classification_v2.region_primary_confidence = "INFERRED"` y se agrega warning `region_primary_inferred_from_*`.

## C-03 rating ETF

Cobertura medida en los 11 ETF de `config/fondos.csv`: 7/11 con `rating.estrellas.overall`; 4/11 nulos.

Nulos observados:

- `IE00B4ND3602` iShares Physical Gold ETC
- `IE000DR59CI3`
- `IE000M7V94E1`
- `IE000X59ZHE2`

Conclusión: las respuestas crudas `screener`, `MFsnapshot` y `ETFsnapshot` existen, pero no contienen rating de estrellas para esos casos. Se documenta como N/A estructural de la fuente, no como error de mapeo.

## C-05 TER 5.00

Caso: `LU0430492750`.

Contraste local de crudos Morningstar:

- `MFsnapshot.TotalExpenseRatio = 5.0`
- `MFsnapshot.OngoingCharge = 0.5`
- `screener.OngoingCharge = 0.5`
- `Mifid.OngoingCostActual = 0.5009`
- `sal_investmentFee.actualInvestmentFees.kiidOngoingCharge = 0.5`

Conclusión: `TotalExpenseRatio=5.0` es un valor escalado/anomalo frente a KIID/MiFID. El extractor ahora prioriza `OngoingCharge`/`NetExpenseRatio` y solo usa `TotalExpenseRatio` si no hay alternativa.
