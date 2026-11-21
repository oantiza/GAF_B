"""Escribe en las fichas SOLO el contraste del índice con el KID, sin pasada.

    python tools/anota_indice_kid.py            # todos los fondos y ETF con índice
    python tools/anota_indice_kid.py LU0203975437 ...
    python tools/anota_indice_kid.py --en-seco  # cuenta por estado, no escribe

Por qué existe (07-11-2026). La fuente `indice_kid` corre en cada `update`, pero una pasada
sin red sobre los 679 fondos y ETF con índice no movía solo el bloque nuevo: traía también lo
que esperaba en el código y la configuración desde la última pasada de esas fichas (05-11).
Eran relativas nuevas en 6 fondos por los proxies del camino A, relativas retiradas en 5 que
se medían contra sí mismos, el VL de un ETF, la identidad de FIRDS en 289 y la calidad
recalculada con la fecha del día. El encargo era no cambiar ninguna cifra, así que esto añade
el bloque y nada más, con la misma función que usa la fuente y desde lo que ya dice la ficha:
el índice de Morningstar y la huella de su KID.

Lo que escribe en cada ficha: `identificacion.indice_benchmark_kid` y su procedencia
(`indice_kid:kid_en_cache`), y añade `indice_kid` a `meta.fuentes.identificacion`. No toca
`meta.actualizado` ni `meta.actualizacion_parcial`, porque `core/calidad.py` lee esa fecha
como la de la pasada, y el bloque lleva la suya, `fecha_comprobacion`. Un bloque anterior
se sustituye entero.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from core.adaptador_bdb import _benchmark  # noqa: E402
from core.store import Store  # noqa: E402
from fetchers import indice_kid  # noqa: E402

RUTA = "identificacion.indice_benchmark_kid"
PROCEDENCIA = "indice_kid:kid_en_cache"


def _candidatos(isins: list[str]) -> list[str]:
    if isins:
        return [i.strip().upper() for i in isins]
    with (BASE / "config" / "fondos.csv").open(encoding="utf-8") as fh:
        return [r["isin"].strip().upper() for r in csv.DictReader(fh)
                if (r.get("tipo") or "").strip() in ("fondo", "etf")]


def anota(ficha: dict, isin: str) -> dict | None:
    """El bloque nuevo para esa ficha, o None si no declara índice."""
    out = indice_kid.fetch(isin, base=BASE, previo={"_anterior": ficha})
    return ((out.get("identificacion") or {}).get("indice_benchmark_kid")) if out else None


def aplica(ficha: dict, bloque: dict) -> dict:
    ident = ficha.setdefault("identificacion", {})
    ident["indice_benchmark_kid"] = bloque
    meta = ficha.setdefault("meta", {})
    proc = {k: v for k, v in (meta.get("procedencia") or {}).items()
            if not k.startswith(RUTA + ".")}
    proc.update({f"{RUTA}.{clave}": PROCEDENCIA for clave in bloque})
    meta["procedencia"] = dict(sorted(proc.items()))
    fuentes = meta.setdefault("fuentes", {})
    lista = list(fuentes.get("identificacion") or [])
    if "indice_kid" not in lista:
        # Antes de `config_csv`, que es la última por construcción (nucleo.adquiere).
        lista.insert(lista.index("config_csv") if "config_csv" in lista else len(lista), "indice_kid")
    fuentes["identificacion"] = lista
    return ficha


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("isins", nargs="*")
    ap.add_argument("--en-seco", action="store_true")
    args = ap.parse_args()
    store, estados, escritas = Store(BASE), Counter(), 0
    for isin in _candidatos(args.isins):
        ruta = BASE / "data" / "funds" / f"{isin}.json"
        if not ruta.exists():
            continue
        ficha = json.loads(ruta.read_text(encoding="utf-8"))
        if not _benchmark(ficha):
            continue
        bloque = anota(ficha, isin)
        if not bloque:
            continue
        estados[bloque["estado"]] += 1
        if not args.en_seco:
            store.escribe_fondo(isin, aplica(ficha, bloque))
            escritas += 1
    print(json.dumps({"por_estado": dict(estados), "total": sum(estados.values()),
                      "escritas": escritas}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
