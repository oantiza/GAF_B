# BLOQUE 24B: Public Contracts v1 / Query + Search Contracts

## Objetivo del bloque
Formalizar la primera versión de contratos públicos (interfaces) para consumidores externos de la BBDD de Activos Financieros (NUVIA, BDB-FONDOS, etc.), abstrayendo la complejidad de lectura en Firestore y estableciendo reglas claras de acoplamiento seguro.

## Archivos creados y modificados
- **[NUEVO]** `src/contracts/publicContracts.ts`: Exporta contratos para Tipos de Activos, Costes de Lectura, Status de Cobertura, Resúmenes de Holdings, y Respuestas de Queries/Search.
- **[MODIFICADO]** `src/readModels/queryLayer.ts`: Actualizado para extender y usar nativamente las interfaces de `publicContracts.ts`, consolidando la semántica.
- **[NUEVO]** `scripts/runPublicContractsPreview.ts`: Script que genera previews de los contratos a partir de objetos mock con type safety estricto.
- **[MODIFICADO]** `package.json`: Se agregó el comando `npm run preview:public-contracts`.
- **[NUEVO]** `tests/publicContracts.test.ts`: Validación unitaria de las interfaces para comprobar restricciones y lógicas (como exclusión de `EQUITY` para el tipo nativo y correcto mapeo de `N_DOCUMENT_READS`).
- **[NUEVO]** `docs/PUBLIC_CONTRACTS_V1.md`: Reglas y manual de uso para consumidores externos.
- **[NUEVO]** `docs/BLOQUE_24B_PUBLIC_CONTRACTS_V1_0.md`: Este reporte.

## Comandos ejecutados
- `npm run typecheck`
- `npm test`
- `npm run preview:public-contracts`

## Resultados y Confirmaciones
- **Typecheck**: PASS.
- **Tests**: PASS. Las pruebas reafirman el diseño sin acoplar lógicas de Firestore.
- **Preview**: PASS. El contrato es legible e impreso sin acceso a BBDD.
- **Firestore Writes**: 0
- **Firestore Deletes**: 0
- **Seguridad**: No se activaron writes reales ni se subieron archivos basura ni artifacts de scratch.

## Próximos Pasos Recomendados
1. Integrar esta capa estable en `BDB-FONDOS` en una PR en su respectivo repositorio, importando los tipos o adaptando su lógica interna para migrar las llamadas desde Firestore crudo a estos modelos estandarizados.
2. Iniciar el soporte en Backend / Cloud Functions (Bloque futuro) si se decide encapsular estas Query/Search layers detrás de un endpoint o SDK para mayor seguridad.
