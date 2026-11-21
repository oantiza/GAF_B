"""Persistencia: JSON por fondo, índice global y snapshots históricos."""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from .schema import cuenta_campos
from .package_integrity import atomic_write_text

log = logging.getLogger("fondosdb.store")


class Store:
    def __init__(self, base_dir: Path):
        self.base = Path(base_dir)
        self.funds_dir = self.base / "data" / "funds"
        self.history_dir = self.base / "data" / "history"
        self.index_path = self.base / "data" / "index.json"
        for d in (self.funds_dir, self.history_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ por fondo
    def escribe_fondo(self, isin: str, datos: dict) -> Path:
        ruta = self.funds_dir / f"{isin}.json"
        atomic_write_text(ruta, json.dumps(datos, ensure_ascii=False, indent=2))
        return ruta

    def snapshot(self, isin: str, datos: dict) -> None:
        """Una línea JSON por ejecución y fondo: histórico barato y diffable."""
        resumen = {
            "fecha": dt.date.today().isoformat(),
            "vl": _g(datos, "valoracion", "vl"),
            "vl_fecha": _g(datos, "valoracion", "vl_fecha"),
            "patrimonio_meur": _g(datos, "valoracion", "patrimonio_fondo_meur"),
            "ter_pct": _g(datos, "costes", "ter_pct"),
            "estrellas": _g(datos, "rating", "estrellas", "overall"),
            "rent_1a": _g(datos, "rentabilidad", "trailing_pct", "1a", "fondo"),
        }
        ruta = self.history_dir / f"{isin}.jsonl"
        with ruta.open("a", encoding="utf-8") as f:
            f.write(json.dumps(resumen, ensure_ascii=False) + "\n")

    # -------------------------------------------------------------- índice
    def reconstruye_indice(self) -> dict:
        indice = {"actualizado": dt.datetime.now().isoformat(timespec="seconds"),
                  "fondos": []}
        for ruta in sorted(self.funds_dir.glob("*.json")):
            try:
                d = json.loads(ruta.read_text(encoding="utf-8"))
            except Exception:
                log.warning("índice: no puedo leer %s", ruta.name)
                continue
            con, tot = cuenta_campos(d)
            indice["fondos"].append({
                "isin": _g(d, "meta", "isin") or ruta.stem,
                "nombre": _g(d, "identificacion", "nombre"),
                "tipo": _g(d, "identificacion", "tipo"),
                "categoria": _g(d, "identificacion", "categoria_morningstar"),
                "ter_pct": _g(d, "costes", "ter_pct"),
                "vl": _g(d, "valoracion", "vl"),
                "vl_fecha": _g(d, "valoracion", "vl_fecha"),
                "estrellas": _g(d, "rating", "estrellas", "overall"),
                "actualizado": _g(d, "meta", "actualizado"),
                "fuentes": sorted({f for lst in (_g(d, "meta", "fuentes") or {}).values()
                                   for f in (lst or [])}),
                "campos_con_dato": con,
            })
        atomic_write_text(
            self.index_path, json.dumps(indice, ensure_ascii=False, indent=2))
        return indice


def _g(d: dict, *ruta, default=None):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d
