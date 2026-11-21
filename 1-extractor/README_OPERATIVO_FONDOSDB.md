# FondosDB — guía operativa (corta)

**Qué es**: fuente local de datos fundamentales de 496 fondos/ETFs. Lee Morningstar/CNMV/justETF y genera un JSON limpio por ISIN, listo para cualquier base de datos.

**Qué NO es**: no es BDB-FONDOS, no escribe en Firestore, no sustituye `funds_v3`. Solo produce archivos locales.

## Rutina normal (todo desde `FondosDB.bat` / `python app.py`)

1. **Actualizar todo** (sin forzar) — refresca datos; con caché válida apenas descarga.
2. `python main.py calidad` — opcional, recalcula score y flags.
3. `python main.py export` — export universal en `export/` (NDJSON + CSV).
4. **Exportar a BDB** (botón) — canónicos en `export_bdb/`.

## Regla BDB

`export_bdb/` es **input para dry-run/gate** de tu flujo BDB-FONDOS. Nunca cargar directo en producción sin pasar por tu validación.

## Limitaciones conocidas

- SFDR = null (Morningstar no lo entrega por las APIs libres; la vía futura son los KID).
- Fondos RF españoles pequeños: sin analítica completa en Morningstar (flags `rf_sin_*`).
- Dependencia principal: APIs públicas de Morningstar (pueden cambiar sin aviso).

## Cuarentena (no reintroducir sin validar clase comercializable en España)

`data/quarantine/blocked_2026-06-11/`: ES0141116030 (ISIN roto), LU0188151095 y LU0564184074 (clases no comercializadas en España; sustituir por la clase ES correspondiente si interesan).

## Restaurar

- ZIP estable en `..\_BACKUPS_FONDOSDB\` (incluye código + datos + exports; sin caché ni secretos).
- Historial: `git log` en la carpeta del proyecto (repo local, sin remoto).
  Nota: OneDrive y carpetas `.git` no se llevan del todo bien; el ZIP es la copia de seguridad de referencia.
