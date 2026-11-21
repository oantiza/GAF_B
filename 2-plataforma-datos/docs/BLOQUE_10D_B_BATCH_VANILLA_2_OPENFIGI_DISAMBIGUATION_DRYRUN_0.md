# Bloque 10D-B — Batch Vanilla 2 OpenFIGI Disambiguation Dry-Run

## Contexto y Objetivo
En el bloque 10D, la consulta global a OpenFIGI basada únicamente en el ISIN retornó cientos de matches para cada uno de los 4 activos (VTI.US, AGG.US, ACWI.US, GLD.US), ya que estos ETFs cotizan en múltiples bolsas internacionales. Todos los candidatos quedaron en estado `AMBIGUOUS_MATCHES`.

El objetivo de este Bloque 10D-B ha sido ejecutar una estrategia de desambiguación estructurada en modo Dry-Run (sin afectar la base de datos Firestore) para reducir el espectro y encontrar el listado correcto primario en EE. UU.

## Estrategia de Desambiguación
Se adoptó la estrategia preferente **Opción A**: `ID_ISIN` + `exchCode = "US"`.
Esta estrategia instruye a OpenFIGI a buscar el ISIN pero filtrando directamente por el código consolidado de país/bolsa `US`. Esta táctica evita usar `micCode` y `exchCode` en la misma petición (lo cual está prohibido por las reglas API) y usualmente es suficiente para ETFs vanilla cuyo origen primordial es Estados Unidos.

El payload (limitado a 4 identificadores) tuvo la siguiente estructura:
`{ "idType": "ID_ISIN", "idValue": "<ISIN>", "exchCode": "US" }`

## Resultados de Desambiguación
La ejecución en Live de la API de OpenFIGI mediante el script `scripts/runBatchVanilla2OpenFigiDisambiguationDryRun.ts` fue rotunda:

| Ticker | ISIN | Matches Totales Previos (10D) | Matches Tras Desambiguación (10D-B) | Estado Final |
|---|---|---|---|---|
| **VTI.US** | US9229087690 | 101 | 1 | **DISAMBIGUATED_CANDIDATE** |
| **AGG.US** | US4642872265 | 101 | 1 | **DISAMBIGUATED_CANDIDATE** |
| **ACWI.US**| US4642882579 | 99 | 1 | **DISAMBIGUATED_CANDIDATE** |
| **GLD.US** | US78463V1070 | 235 | 1 | **DISAMBIGUATED_CANDIDATE** |

Los 4 candidatos se resolvieron satisfactoriamente obteniendo un único match, lo que permitió consolidarlos con su verdadero FIGI y nested identifiers, sin la necesidad de escalar a revisiones manuales adicionales. No existieron cruces ni duplicados entre ellos.

## Artefactos Generados
Ruta: `artifacts/batch_vanilla_2_openfigi_disambiguation_dryrun_0/`
* `input_ambiguous_candidates.json`: Los candidatos tal y como quedaron tras el bloque 10D.
* `disambiguation_request_plan.json`: Solicitudes base.
* `openfigi_disambiguation_payload_redacted.json`: El payload limpio y seguro.
* `openfigi_disambiguation_response_summary.json`: El recuento de matches post-filtro.
* `disambiguated_candidates.json`: Los 4 candidatos exitosamente enriquecidos con su identidad OpenFIGI (`identifiers.figi`, `identifiers.composite_figi`, etc.).
* `still_ambiguous_candidates.json`: (Vacío).
* `review_candidates.json`: (Vacío).
* `rejected_candidates.json`: (Vacío).
* `duplicate_groups.json`: (Vacío).
* `safety_check_summary.json`: Certificado de cumplimiento de restricciones.
* `dryrun_summary.json`: Estado final de la ejecución (`PASS`).

## Validación de Seguridad
- **Firestore Writes / Deletes:** 0.
- **FIRESTORE_REAL_WRITE_ENABLED:** No activado (falso).
- **API Keys expuestas:** NO.
- **Modificación de Assets o `asset_id` originarios:** NO.
- **Flat `identifiers.*` creados:** NO. Solo nested.
- **BDB-FONDOS/CORE modificados:** NO.
- **Commits / Push:** NO.

## Siguiente Paso Recomendado
Se recomienda proseguir al bloque **10E — Batch Vanilla 2 Firestore Write Gate Prep**, apoyándose en la base limpia de `disambiguated_candidates.json` para armar los payloads definitivos de escritura sin que aún toquen Firestore. Esto consolida el flujo de datos preparatorio de cara a la eventual ingesta.
