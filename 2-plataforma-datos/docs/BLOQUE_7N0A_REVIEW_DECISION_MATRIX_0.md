# BLOQUE 7N-0A — Review Decision Matrix for GSPC/AAPU + Next Scaling Path

## Objetivo
El objetivo de este bloque es crear una matriz de decisión para determinar si los activos que están actualmente en estado de revisión (GSPC.INDX y AAPU.US) deben escribirse en Firestore y definir las reglas/condiciones conceptuales previas necesarias antes de aprobar escrituras de este tipo de activos. Todo esto se hace sin ejecutar operaciones de escritura/borrado, asegurando la consistencia de la base de datos actual.

## Estado de Activos Validados y Escritos Localmente
Los siguientes activos ya tienen su `price_series` y `metrics` validados y el candidato de escritura cerrado:
- AAPL
- SPY
- QQQ
- IWDA

## Estado de GSPC.INDX (S&P 500 Index Proxy)
- **asset_id**: EODHD:GSPC.INDX
- **listing_id**: EODHD_GSPC.INDX
- **dryrun_status**: REVIEW_FOR_7L_1
- **Observaciones**: 107
- **history_quality_status**: OK
- **Descripción**: Es un índice/proxy provisional.
- **Riesgo Identificador**: ALTO (Usa un ticker provisional `EODHD:GSPC.INDX` ya que OpenFIGI no lo resolvió o está en estado dry-run).
- **Riesgo Conceptual**: MEDIO/ALTO. Escribir precios de índices requiere una política de proxy/index bien definida.

## Estado de AAPU (Leveraged Single-Stock ETF)
- **asset_id**: US25461A8743
- **listing_id**: EODHD_AAPU.US
- **dryrun_status**: REVIEW_FOR_7M_1
- **Observaciones**: 107
- **history_quality_status**: OK
- **Descripción**: Es un ETF apalancado single-stock (basado en AAPL).
- **Riesgo Producto**: ALTO.
- **Riesgo Suitability**: ALTO. (Requiere clasificación especial de riesgo y control de que no se mezcle como representativo/diversificado).

## Matriz de Riesgos y Decisiones
| Activo | Calidad de Precios Técnica | Riesgo Conceptual/Producto | Riesgo Identificador | Recomendación de Escritura |
|--------|-----------------------------|----------------------------|----------------------|----------------------------|
| **GSPC** | OK | MEDIO/ALTO (Índice/Proxy) | ALTO (Provisional) | **DO_NOT_WRITE_YET** |
| **AAPU** | OK | ALTO (Leveraged ETF) | BAJO | **DO_NOT_WRITE_YET** |

### Preconditions antes de cualquier Write para estos activos
1. **GSPC.INDX**:
   - Definir política para índices/proxies.
   - Decidir si se utilizará un `asset_id` canónico o si se acepta el provisional de EODHD en la DB final.
   - Decidir si se guardan métricas para benchmarks/proxies y su uso futuro.
2. **AAPU**:
   - Definir política de clasificación para ETFs single-stock/apalancados.
   - Definir banderas de riesgo/idoneidad (suitability/risk flags).
   - Asegurar que no se categoricen erróneamente como ETFs representativos/diversificados.

## Recomendación de Siguiente Bloque
**Siguiente Bloque Recomendado**: C) Batch nuevo de activos vanilla/representativos.

**Justificación**: Es mucho más seguro y valioso en esta fase del desarrollo seguir escalando la base de datos con activos "vainilla" (por ejemplo, acciones convencionales adicionales o ETFs estándar que representen diversificación) para robustecer la arquitectura principal. Escribir GSPC o AAPU ahora introduce un riesgo conceptual importante sin haber definido las políticas explícitas en el pipeline de validación y de bases de datos de la plataforma. Dejarlos en estado de revisión y retomar un batch seguro permitirá avanzar sostenidamente hasta que la arquitectura soporte la clasificación de proxies/índices y ETFs complejos.

## Confirmaciones de Seguridad
- **Firestore writes**: 0
- **Firestore deletes**: 0
- **FIRESTORE_REAL_WRITE_ENABLED activado**: NO
- **EODHD live usado**: NO
- **EODHD fundamentals usado**: NO
- **OpenFIGI live usado**: NO
- **Credenciales y API Keys impresas**: NO
- **Deploy**: NO
- **Push**: NO
- **Commit**: NO
- **BDB-FONDOS tocado**: NO
- **BDB-FONDOS-CORE tocado**: NO
