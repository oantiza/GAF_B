# Bloque 4B: Auditoría y Refactorización del Mapper de EODHD

## 1. Objetivo
Asegurar que la traducción de datos provenientes de la API de EODHD respete la estricta taxonomía canónica interna antes de autorizar las conexiones reales.

## 2. Hallazgos y Correcciones

### 2.1 Mapeo de `asset_type`
Anteriormente, el mapper traducía los tipos "Stock" o "Common Stock" de EODHD directamente a la constante `EQUITY`. Esto violaba la regla canónica, ya que `EQUITY` es la clase del activo (`classification.asset_class`), pero su formato jurídico/tipo base debe ser `STOCK`.

**Corrección implementada:**
1. Se ha actualizado `AssetType` (`src/types/assets.ts`) y `assetValidator.ts` para desechar `EQUITY` en favor de la nomenclatura estricta: `'FUND' | 'ETF' | 'STOCK' | 'INDEX' | 'OTHER' | 'UNKNOWN'`.
2. El mapper de EODHD ahora inyecta `asset_type: 'STOCK'` cuando detecta acciones.
3. El mapper de EODHD ahora inyecta `asset_type: 'OTHER'` si el tipo es desconocido, el cual es válido estructuralmente (pasará la barrera del schema) pero quedará marcado como `REVIEW` para revisión manual.

### 2.2 Promoción a `classification.asset_class`
Se añadió de manera oficial el bloque `classification` a las interfaces base del sistema.
Cuando `eodhdMapper.ts` detecta una acción, no solo asigna el tipo correcto, sino que propaga el conocimiento declarando explícitamente:
```typescript
classification: {
    asset_class: 'EQUITY'
}
```
*Nota: Para los ETFs y Mutual Funds, `asset_class` permanece nulo (`null`), ya que EODHD no proporciona el subyacente (puede ser un ETF de renta fija o renta variable). Esta inferencia queda delegada a fases futuras de enriquecimiento.*

## 3. Pruebas y Aislamiento
- **Cobertura**: Todos los fixtures locales (CSV sintéticos, JSON sintéticos) y tests unitarios que referenciaban `EQUITY` como `asset_type` fueron migrados limpiamente a `STOCK`.
- Se añadieron aserciones específicas verificando la doble inyección (`STOCK` + `EQUITY`).
- **Seguridad**: Ningún proceso ha invocado a la red. Las barreras de acceso a Firestore permanecen inquebrantables.

## 4. Estado de los Tests (Post-Auditoría)
La suite completa de tests automatizados (38 tests) validan la estanqueidad de este contrato lógico con cero fallos.
