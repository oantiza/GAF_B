# 🟢 ROL: BASE DE DATOS MAESTRA — proyecto NUEVO

Esta carpeta es la **base de datos maestra (SSOT)** en Firestore, con su ingesta y contratos. Proyectos: `gestor-activos-local` (la base de siempre, en el emulador) y `bdb-gestor-de-activos` (la base nueva). Los fija `src/config/projectAllowlist.ts`.

- **Recibe de:** `fondosdb` (fondos) + EODHD / OpenFIGI.
- **Sirve a:** `BDB-ACTIVOS` (la app nueva).
- **No confundir:** la base antigua es `bdb-fondos` (dentro de `BDB-FONDOS`, legacy, aparte).
- **Mapa completo, estado y plan:** Panel de Control →
  `C:\Users\oanti\Documents\BDB-ACTIVOS\docs\PANEL_DE_CONTROL.md`

> Datos pesados (`artifacts/`) = no versionar salvo fixtures mínimos.
