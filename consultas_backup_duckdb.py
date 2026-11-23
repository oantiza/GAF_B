# -*- coding: utf-8 -*-
"""
Consultas SQL ad-hoc sobre los backups de la maestra BDB (F3-F.2, sidecar DuckDB).
Uso:  pip install duckdb   →   python consultas_backup_duckdb.py [carpeta-o-prefijo]
Sin argumento usa la copia completa más reciente de 2-plataforma-datos/data/backups.
Las carpetas se llaman por la hora de la copia (p. ej. 2026-10-14T18-42-34-368Z);
basta un prefijo como 2026-10-14. Solo LECTURA de los .ndjson.gz.

Formato bdb-complete-backup.v2 (desde el 10-07-2026): un fichero por colección
raíz. assets.ndjson.gz lleva juntas las raíces y sus subcolecciones, una línea
por documento con {path, root_collection, data}. Se separan por la profundidad
de path:
  assets/{id}                                    -> raíz (2 segmentos)
  assets/{id}/metrics/latest, .../price_series/… -> subcolección (más de 2)
"""
import json
import sys
from pathlib import Path

FORMATO = "bdb-complete-backup.v2"
BASE = Path(__file__).resolve().parent / "2-plataforma-datos" / "data" / "backups"


def es_copia_completa(carpeta: Path) -> bool:
    """Copia v2 terminada y verificada: manifiesto con el formato, assets.ndjson.gz
    y summary.json con verification PASS (el mismo criterio que la plataforma en
    maintainLocalBackups.ts, borrado el 21-11-2026 con la base vieja).

    Una exportación interrumpida deja la carpeta sin manifest.json; el exportador
    escribe el manifiesto antes de verificar, así que sin PASS tampoco vale.
    """
    manifiesto = carpeta / "manifest.json"
    resumen = carpeta / "summary.json"
    if not (manifiesto.is_file() and resumen.is_file() and (carpeta / "assets.ndjson.gz").is_file()):
        return False
    try:
        formato_ok = json.loads(manifiesto.read_text(encoding="utf-8")).get("format_version") == FORMATO
        return formato_ok and json.loads(resumen.read_text(encoding="utf-8")).get("verification") == "PASS"
    except (OSError, ValueError):
        return False


def elegir_copia(prefijo: str | None = None, base: Path = BASE) -> Path:
    """La copia completa más reciente, o la más reciente cuyo nombre empiece por `prefijo`."""
    if not base.is_dir():
        sys.exit(f"No existe la carpeta de copias: {base}")
    carpetas = sorted(p for p in base.iterdir()
                      if p.is_dir() and (prefijo is None or p.name.startswith(prefijo)))
    completas = [p for p in carpetas if es_copia_completa(p)]
    if not completas:
        filtro = f" que empiece por «{prefijo}»" if prefijo else ""
        sys.exit(f"No hay ninguna copia {FORMATO} completa{filtro} en {base} "
                 f"({len(carpetas)} carpetas revisadas; las que no tienen manifest.json "
                 "o assets.ndjson.gz, o sin verification PASS en summary.json, se saltan).")
    return completas[-1]


def main() -> None:
    # Las tablas de DuckDB llevan caracteres de caja: con la salida redirigida en
    # Windows (cp1252) print lanzaría UnicodeEncodeError.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        import duckdb
    except ImportError:
        sys.exit("Falta duckdb: pip install duckdb")

    copia = elegir_copia(sys.argv[1] if len(sys.argv) > 1 else None)
    assets = str(copia / "assets.ndjson.gz").replace("\\", "/")
    print(f"Backup: {copia}\n")

    con = duckdb.connect()
    # data se lee como JSON, sin inferir esquema: raíces y subcolecciones tienen
    # formas muy distintas y una inferencia conjunta sería lenta y frágil.
    con.execute(f"""
        CREATE VIEW docs AS
        SELECT path,
               split_part(path, '/', 2)     AS id,
               len(string_split(path, '/')) AS profundidad,
               data
        FROM read_ndjson('{assets}',
                         columns = {{path: 'VARCHAR', root_collection: 'VARCHAR', data: 'JSON'}},
                         maximum_object_size = 20000000)""")
    # Las raíces (~1.100) se materializan una vez; las subcolecciones (~23.000,
    # casi todas price_series) se leen del fichero en cada consulta.
    con.execute("CREATE TABLE roots AS SELECT id, data FROM docs WHERE profundidad = 2")
    con.execute("CREATE VIEW subs AS SELECT path, id, data FROM docs WHERE profundidad > 2")

    def q(titulo, sql):
        print(f"== {titulo} ==")
        print(con.sql(sql))

    q("Documentos por profundidad de path (2 = raíz)",
      "SELECT profundidad, count(*) n FROM docs GROUP BY 1 ORDER BY 1")

    q("Activos por tipo",
      "SELECT data->>'$.asset_type' tipo, count(*) n FROM roots GROUP BY 1 ORDER BY n DESC")

    q("TER por tipo (medio / max)",
      """SELECT data->>'$.asset_type' tipo,
                round(avg(TRY_CAST(data->>'$.costs.ter_pct' AS DOUBLE)), 3) ter_medio,
                max(TRY_CAST(data->>'$.costs.ter_pct' AS DOUBLE)) ter_max, count(*) n
         FROM roots WHERE TRY_CAST(data->>'$.costs.ter_pct' AS DOUBLE) IS NOT NULL
         GROUP BY 1 ORDER BY n DESC""")

    q("Región primaria (top 10)",
      """SELECT coalesce(data->>'$.classification.region_primary', '(nulo)') region, count(*) n
         FROM roots GROUP BY 1 ORDER BY n DESC LIMIT 10""")

    # La clave "3y" empieza por cifra: se usa la sintaxis de puntero JSON (/a/b/c).
    q("Top 10 volatilidad 3A (metrics/latest)",
      """SELECT id isin,
                round(TRY_CAST(data->>'/windows/3y/annualized_volatility' AS DOUBLE) * 100, 2) vol3a,
                round(TRY_CAST(data->>'/windows/3y/sharpe_ratio' AS DOUBLE), 2) sharpe3a
         FROM subs
         WHERE path LIKE '%/metrics/latest'
           AND TRY_CAST(data->>'/windows/3y/annualized_volatility' AS DOUBLE) IS NOT NULL
         ORDER BY vol3a DESC LIMIT 10""")

    q("Frescura de metrics/latest (por día de updated_at)",
      """SELECT substr(data->>'$.updated_at', 1, 10) dia, count(*) n
         FROM subs WHERE path LIKE '%/metrics/latest' GROUP BY 1 ORDER BY 1 DESC LIMIT 8""")

    q("Control: raíces con id no-ISIN (legacy pendientes de archivar)",
      """SELECT id, data->>'$.asset_type' tipo FROM roots
         WHERE NOT regexp_matches(id, '^[A-Z]{2}[A-Z0-9]{9}[0-9]$') ORDER BY id LIMIT 20""")

    print("Edita/añade consultas a gusto: es SQL estándar sobre ficheros locales, sin tocar Firestore.")
    print("Tablas: docs (todo), roots (raíces), subs (subcolecciones); data es JSON (data->>'$.campo').")


if __name__ == "__main__":
    main()
