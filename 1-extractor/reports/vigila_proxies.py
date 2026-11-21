# -*- coding: utf-8 -*-
"""Vigilancia anual de los proxies de índice: el instrumento contra su propio índice.

Es la medición anual de la decisión 33 (DECISIONES_DATOS_2026-11-07.md): un instrumento
aprobado prevalece como comparador mientras explique su índice con R² ≥ 99 % y no se le
desvíe más de ±0,5 puntos al año. Si falla, la fila cambia al nivel de índice con retirada
fechada (§10 del método); eso lo decide Óscar, no este script. La regla entera está en
`core/indices.py` y en `config/indices.README.md`.

    python reports/vigila_proxies.py [--fin AAAA-MM-DD] [--sin-red] [--cache-compartida]

**Qué hace.** Para cada fila de `config/indices.csv` con clase `VALOR_LIQUIDATIVO` o
`PRECIO_DE_MERCADO` mira en `config/indices_vigilancia.csv` si existe en la bolsa `INDX` de
EODHD la serie del índice con la misma variante. Esa correspondencia la escribe una persona,
fila a fila, y **nunca se adivina por nombre**: EODHD llama «STXE 600 NRT» al STOXX Europe 600
NR. Para cada fila con serie trae el proxy por la misma vía que la pasada de producción
(`vl_fondos._serie_del_proxy`: un fondo por `{ISIN}.EUFUND`, un ETF por su `simbolo_eodhd`, el
índice por `CODIGO.INDX` con la divisa del catálogo), todo en euros con los cambios del BCE, y
mide a cierre de mes a 1, 3 y 5 años:

- **R²** de las rentabilidades mensuales del proxy contra las del índice.
- **Deriva** anualizada de log(proxy/índice) entre el primer y el último cierre de la ventana,
  en puntos porcentuales; positiva cuando el proxy gana al índice.
- **Meses comunes** y, de propina, el tracking error.

Una ventana sin sus 12, 36 o 60 meses consecutivos comunes se dice y no se cuenta. La fila
PASA si todas las ventanas disponibles cumplen R² ≥ 0,99 y |deriva| ≤ 0,5; FALLA si alguna no;
SIN_DATOS si no hay ninguna ventana. Imprime una tabla y escribe
`reports/vigilancia_proxies_<fecha>.json`.

**Qué no hace.** No escribe en `data/`, no toca `indices.csv` ni la tabla de vigilancia y no
cambia ninguna cifra publicada: es una lectura con la que Óscar decide.

**La caché.** Usa el mismo cliente `core.http.Http` que el extractor pero apuntado a una caché
propia, `cache/vigilancia_proxies/http`, que no es la de la pasada (`cache/http`). Así una
ejecución de vigilancia no deja en la caché compartida entradas de `precio` que la pasada
siguiente leería como frescas, ni se sirve de las de la pasada sin saberlo; cuesta unas ocho
peticiones al año. Con `--cache-compartida` se usa `cache/http` a sabiendas. `--sin-red` falla
en vez de salir a red si algo no está en la caché elegida.

El token de EODHD sale de `EODHD_API_TOKEN` o de `config/secrets.json`, como siempre, y no se
escribe en el JSON ni en la tabla.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import re
import statistics
import sys
from datetime import date, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from core import indices, metricas  # noqa: E402

log = logging.getLogger("fondosdb.vigila_proxies")

CLASES_VIGILADAS = ("VALOR_LIQUIDATIVO", "PRECIO_DE_MERCADO")
VENTANAS = (("1a", 12), ("3a", 36), ("5a", 60))
# Umbrales de la decisión 33. El R² va en fracción (0,99 = 99 %) y la deriva en puntos
# porcentuales anuales.
R2_MINIMO = 0.99
DERIVA_MAXIMA_PT = 0.5

RUTA_TABLA = BASE / "config" / "indices_vigilancia.csv"
CACHE_PROPIA = BASE / "cache" / "vigilancia_proxies" / "http"
CARPETA_SALIDA = BASE / "reports"

# Un código de la bolsa INDX, sin el sufijo: la tabla guarda `SX5T`, no `SX5T.INDX`.
RE_CODIGO_INDX = re.compile(r"^[A-Z0-9][A-Z0-9._-]*$")
COLUMNAS_TABLA = ("benchmark", "variante", "indice", "nota")


# ----------------------------------------------------------------- la tabla
def carga_tabla(ruta: Path = RUTA_TABLA) -> dict[tuple[str, str | None], dict]:
    """{(nombre plegado, variante): {benchmark, variante, indice, nota}} de la correspondencia.

    `indice` es el código en la bolsa INDX o None («sin serie»). La misma clave que
    `indices.carga`, para que una fila de `indices.csv` case con la suya sin adivinar nada."""
    tabla: dict[tuple[str, str | None], dict] = {}
    with Path(ruta).open(encoding="utf-8-sig", newline="") as fh:
        lector = csv.DictReader(fh)
        faltan = [c for c in COLUMNAS_TABLA if c not in (lector.fieldnames or [])]
        if faltan:
            raise ValueError(f"{ruta.name}: faltan las columnas {faltan}")
        for fila in lector:
            benchmark = (fila.get("benchmark") or "").strip()
            if not benchmark:
                continue
            variante = (fila.get("variante") or "").strip().upper() or None
            codigo = (fila.get("indice") or "").strip().upper() or None
            if codigo is not None:
                if codigo.endswith(f".{indices.BOLSA_INDICES}"):
                    raise ValueError(
                        f"{ruta.name}: el indice va sin sufijo .{indices.BOLSA_INDICES}: {codigo!r} ({benchmark})")
                if not RE_CODIGO_INDX.match(codigo):
                    raise ValueError(f"{ruta.name}: codigo de indice no valido: {codigo!r} ({benchmark})")
            clave = (indices.pliega(benchmark), variante)
            if clave in tabla:
                raise ValueError(f"{ruta.name}: {benchmark!r} {variante or ''} aparece dos veces")
            tabla[clave] = {"benchmark": benchmark, "variante": variante, "indice": codigo,
                            "nota": (fila.get("nota") or "").strip()}
    return tabla


def filas_vigiladas(base: Path = BASE) -> list[dict]:
    """Las filas de `indices.csv` con instrumento como proxy, una vez cada una."""
    vistas: set[str] = set()
    salida = []
    for fila in indices.carga(base).values():
        if fila["clase_de_serie"] not in CLASES_VIGILADAS or fila["declarado"] is not None:
            continue
        marca = f"{fila['benchmark']}|{fila['variante'] or ''}"
        if marca in vistas:
            continue
        vistas.add(marca)
        salida.append(fila)
    return sorted(salida, key=lambda f: (f["benchmark"].lower(), f["variante"] or ""))


def empareja(filas: list[dict], tabla: dict[tuple[str, str | None], dict]) -> list[tuple[dict, dict]]:
    """Cada fila con su línea de la tabla. Una fila sin línea es un error: la pregunta de si
    existe la serie del índice se responde al aprobar la fila, no se deja en blanco."""
    pares = []
    for fila in filas:
        entrada = tabla.get((indices.pliega(fila["benchmark"]), fila["variante"]))
        if entrada is None:
            raise ValueError(
                f"{fila['benchmark']!r} {fila['variante'] or ''} tiene proxy en indices.csv pero no "
                f"tiene línea en {RUTA_TABLA.name}; escribe su código INDX o «sin serie»")
        pares.append((fila, entrada))
    return pares


# -------------------------------------------------------------- la medición
def _consecutivos(fechas: list[date]) -> bool:
    meses = [f.year * 12 + f.month for f in fechas]
    return all(b - a == 1 for a, b in zip(meses, meses[1:]))


def mide(proxy: metricas.Serie, indice: metricas.Serie, fin: date | None = None) -> dict:
    """R², deriva anualizada y meses comunes del proxy contra su índice, a 1, 3 y 5 años.

    Las dos series vienen en euros y diarias. Se toman los cierres de mes de cada una (el mes
    en curso se excluye salvo que `fin` sea un último día de mes), se quedan los meses que están
    en las dos, y cada ventana usa sus últimos n+1 cierres comunes, que han de ser consecutivos.
    La deriva es log(proxy_fin/proxy_inicio) − log(indice_fin/indice_inicio), dividida por n/12
    años y en puntos porcentuales: positiva cuando el proxy gana al índice. El R² es el de las
    rentabilidades mensuales, como en `metricas.relativas`. Una ventana sin datos lo dice en
    `motivo` y no cuenta para el estado."""
    cerrado = fin is not None and (fin + timedelta(days=1)).month != fin.month
    mp = metricas.fin_de_mes(metricas.recorta(proxy, fin), incluir_ultimo=cerrado)
    mi = metricas.fin_de_mes(metricas.recorta(indice, fin), incluir_ultimo=cerrado)
    por_mes_i = {(f.year, f.month): (f, p) for f, p in mi}
    comun = [(f, p, por_mes_i[(f.year, f.month)][1]) for f, p in mp if (f.year, f.month) in por_mes_i]
    out: dict = {
        "meses_comunes": max(len(comun) - 1, 0),
        "ultimo_mes": metricas.ultimo_dia(comun[-1][0]).isoformat() if comun else None,
        "ventanas": {},
    }
    for clave, n in VENTANAS:
        if len(comun) < n + 1:
            out["ventanas"][clave] = {
                "disponible": False,
                "motivo": f"solo {max(len(comun) - 1, 0)} meses comunes y hacen falta {n}"}
            continue
        tramo = comun[-(n + 1):]
        if not _consecutivos([f for f, _p, _i in tramo]):
            out["ventanas"][clave] = {"disponible": False, "motivo": "meses comunes no consecutivos"}
            continue
        rp = [b[1] / a[1] - 1 for a, b in zip(tramo, tramo[1:])]
        ri = [b[2] / a[2] - 1 for a, b in zip(tramo, tramo[1:])]
        if statistics.variance(ri) <= 0 or statistics.variance(rp) <= 0:
            out["ventanas"][clave] = {"disponible": False, "motivo": "una de las series no se mueve"}
            continue
        r = statistics.correlation(rp, ri)
        r2 = r * r
        deriva = (math.log(tramo[-1][1] / tramo[0][1]) - math.log(tramo[-1][2] / tramo[0][2])) / (n / 12) * 100
        te = statistics.stdev([a - b for a, b in zip(rp, ri)]) * math.sqrt(12) * 100
        out["ventanas"][clave] = {
            "disponible": True,
            "meses": n,
            "desde": tramo[0][0].isoformat(),
            "hasta": tramo[-1][0].isoformat(),
            "r2": round(r2, 4),
            "deriva_pt": round(deriva, 2),
            "tracking_error_pct": round(te, 2),
            "pasa": bool(r2 >= R2_MINIMO and abs(deriva) <= DERIVA_MAXIMA_PT),
        }
    disponibles = [v for v in out["ventanas"].values() if v["disponible"]]
    if not disponibles:
        out["estado"] = "SIN_DATOS"
    else:
        out["estado"] = "PASA" if all(v["pasa"] for v in disponibles) else "FALLA"
    return out


# ----------------------------------------------------------------- las series
def series_en_euros(fila: dict, codigo: str, http, token: str, base: Path) -> tuple[metricas.Serie, metricas.Serie]:
    """(proxy, índice) en euros, por la misma vía que la pasada de producción."""
    from fetchers import vl_fondos
    proxy = vl_fondos._serie_del_proxy(fila, http, token, False, base)
    indice = vl_fondos._serie_del_proxy(
        {"proxy": f"{codigo}.{indices.BOLSA_INDICES}", "clase_de_serie": "NIVEL_DE_INDICE"},
        http, token, False, base)
    return proxy, indice


# ----------------------------------------------------------------- la salida
def imprime(resultados: list[dict]) -> None:
    cab = f"{'Fila':<28} {'Proxy':<14} {'Índice':<8} {'Vent.':<5} {'R² %':>7} {'Deriva pt':>10} {'TE %':>6} {'Meses':>5}  Estado"
    print(cab)
    print("-" * len(cab))
    for r in resultados:
        nombre = f"{r['benchmark']} {r['variante'] or ''}".strip()
        if r["indice"] is None:
            print(f"{nombre:<28} {r['proxy']:<14} {'—':<8} {'':<5} {'':>7} {'':>10} {'':>6} {'':>5}  sin serie: {r['nota']}")
            continue
        primera = True
        for clave, v in r["ventanas"].items():
            pre = f"{nombre:<28} {r['proxy']:<14} {r['indice']:<8}" if primera else f"{'':<28} {'':<14} {'':<8}"
            if v["disponible"]:
                print(f"{pre} {clave:<5} {v['r2'] * 100:>7.2f} {v['deriva_pt']:>+10.2f} {v['tracking_error_pct']:>6.2f} {v['meses']:>5}  "
                      f"{'ok' if v['pasa'] else 'NO'}{'   → ' + r['estado'] if primera else ''}")
            else:
                print(f"{pre} {clave:<5} {'—':>7} {'—':>10} {'—':>6} {'—':>5}  {v['motivo']}{'   → ' + r['estado'] if primera else ''}")
            primera = False


def ejecuta(base: Path = BASE, fin: date | None = None, sin_red: bool = False,
            cache_compartida: bool = False, escribe: bool = True) -> dict:
    from core.http import Http
    from fetchers import eodhd

    token = eodhd._token(base)
    if not token:
        raise SystemExit("sin token de EODHD: EODHD_API_TOKEN o config/secrets.json")
    settings = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
    cache_dir = (base / "cache" / "http") if cache_compartida else CACHE_PROPIA
    http = Http(settings, cache_dir, sin_red=sin_red)

    pares = empareja(filas_vigiladas(base), carga_tabla(base / "config" / RUTA_TABLA.name))
    resultados = []
    for fila, entrada in pares:
        r = {"benchmark": fila["benchmark"], "variante": fila["variante"], "proxy": fila["proxy"],
             "clase_de_serie": fila["clase_de_serie"], "indice": entrada["indice"], "nota": entrada["nota"]}
        if entrada["indice"] is None:
            r["estado"] = "SIN_SERIE"
        else:
            proxy, indice = series_en_euros(fila, entrada["indice"], http, token, base)
            r["observaciones"] = {"proxy": len(proxy), "indice": len(indice)}
            if not proxy or not indice:
                r.update({"estado": "SIN_DATOS", "ventanas": {}, "meses_comunes": 0, "ultimo_mes": None,
                          "motivo": "sin serie del " + ("proxy" if not proxy else "índice")})
            else:
                r.update(mide(proxy, indice, fin))
        resultados.append(r)

    hoy = date.today()
    salida = {
        "fecha": hoy.isoformat(),
        "fin": fin.isoformat() if fin else None,
        "regla": "DECISIONES_DATOS_2026-11-07.md, decisión 33",
        "umbrales": {"r2_minimo": R2_MINIMO, "deriva_maxima_pt": DERIVA_MAXIMA_PT,
                     "ventanas_meses": dict(VENTANAS)},
        "metodo": ("cierres de mes comunes en euros; R² de rentabilidades mensuales; deriva = "
                   "log(proxy/índice) anualizada en puntos, positiva si el proxy gana"),
        "cache": str(cache_dir.relative_to(base)),
        "http": {k: http.estadisticas[k] for k in ("red", "cache", "sin_cache")},
        "resumen": {e: sum(1 for r in resultados if r["estado"] == e)
                    for e in ("PASA", "FALLA", "SIN_DATOS", "SIN_SERIE")},
        "filas": resultados,
    }
    imprime(resultados)
    print()
    print("resumen:", salida["resumen"], "| http:", salida["http"], "| caché:", salida["cache"])
    if escribe:
        ruta = CARPETA_SALIDA / f"vigilancia_proxies_{hoy.isoformat()}.json"
        ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
        print("escrito", ruta.relative_to(base))
    return salida


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--fin", type=date.fromisoformat, default=None,
                   help="último día a considerar (AAAA-MM-DD); por defecto, hoy, y el mes en curso no cuenta")
    p.add_argument("--sin-red", action="store_true", help="falla si algo no está en la caché")
    p.add_argument("--cache-compartida", action="store_true",
                   help="usa cache/http, la de la pasada, en vez de la caché propia")
    p.add_argument("--sin-json", action="store_true", help="no escribe el JSON en reports/")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    # La tabla lleva «²» y «—»; la consola de Windows arranca en cp1252 y los rechazaría.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ejecuta(fin=a.fin, sin_red=a.sin_red, cache_compartida=a.cache_compartida, escribe=not a.sin_json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
