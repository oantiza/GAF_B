"""Completa la columna ``nombre`` de config/fondos.csv desde nuestras propias fichas.

Por qué existe: el 01-11-2026, 46 de las 73 acciones del universo tenían la columna
``nombre`` vacía. No es un defecto del dato —sus fichas sí traen
``identificacion.nombre``, resuelto de la fuente: ``Deutsche Bank Aktiengesellschaft``,
``Bayerische Motoren Werke Aktiengesellschaft``— sino del fichero del universo, que es
donde se mira cuál es cada ISIN sin abrir la ficha.

De dónde sale el nombre importa, y es el motivo de que este script lea ``data/funds`` y
no otra cosa: **de nuestras fichas**, que lo resolvieron de la fuente. La base vieja
también lo tiene, y copiarlo de ahí sería heredar el dato en vez de re-originarlo, que es
justo lo que la fase nueva vino a deshacer.

Por defecto solo informa. ``--write`` reescribe el CSV **bajo el bloqueo de ``config/``**
y con escritura atómica, igual que ``core.ops.reclasifica``: el alta de ISIN reescribe ese
mismo fichero, y sin el bloqueo una fila recién añadida se pierde al reescribir (MEDIA-8).
Nunca consulta ni modifica Firestore.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.ops import bloqueo_config, carga_fondos
from core.package_integrity import atomic_write_text

BASE = Path(__file__).resolve().parents[1]


def nombre_de_la_ficha(funds_dir: Path, isin: str) -> str:
    """``identificacion.nombre`` de nuestra ficha, o cadena vacía si no hay de dónde."""
    ruta = funds_dir / f"{isin}.json"
    if not ruta.exists():
        return ""
    try:
        data = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return str((data.get("identificacion") or {}).get("nombre") or "").strip()


def rellena(base: Path, write: bool = False, solo_tipo: str | None = None) -> dict:
    funds_dir = base / "data" / "funds"
    rellenados: list[dict] = []
    sin_ficha: list[str] = []
    sin_nombre_en_ficha: list[str] = []

    with bloqueo_config(base):
        filas = carga_fondos(base)
        for fila in filas:
            isin = str(fila.get("isin") or "").strip().upper()
            tipo = str(fila.get("tipo") or "").strip().lower()
            if solo_tipo is not None and tipo != solo_tipo:
                continue
            if str(fila.get("nombre") or "").strip():
                continue
            nombre = nombre_de_la_ficha(funds_dir, isin)
            if not nombre:
                if (funds_dir / f"{isin}.json").exists():
                    sin_nombre_en_ficha.append(isin)
                else:
                    sin_ficha.append(isin)
                continue
            rellenados.append({"isin": isin, "nombre": nombre, "tipo": tipo})
            fila["nombre"] = nombre

        if write and rellenados:
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(["isin", "nombre", "tipo"])
            for fila in filas:
                w.writerow([
                    str(fila.get("isin") or "").strip().upper(),
                    fila.get("nombre") or "",
                    (fila.get("tipo") or "fondo").strip(),
                ])
            atomic_write_text(base / "config" / "fondos.csv", buf.getvalue())

    return {
        "modo": "ESCRIBE" if write else "solo informa",
        "rellenados": rellenados,
        "sin_ficha": sin_ficha,
        "sin_nombre_en_ficha": sin_nombre_en_ficha,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="reescribe config/fondos.csv")
    parser.add_argument("--tipo", default=None, help="limita a un tipo (p.ej. accion)")
    args = parser.parse_args()

    r = rellena(BASE, write=args.write, solo_tipo=args.tipo)
    print(f"modo                     : {r['modo']}")
    print(f"filas con nombre puesto  : {len(r['rellenados'])}")
    print(f"sin ficha en data/funds  : {len(r['sin_ficha'])}")
    print(f"con ficha y sin nombre   : {len(r['sin_nombre_en_ficha'])}")
    for fila in r["rellenados"][:10]:
        print(f"    {fila['isin']}  {fila['nombre']}  ({fila['tipo']})")
    if len(r["rellenados"]) > 10:
        print(f"    ... y {len(r['rellenados']) - 10} más")
    if r["sin_ficha"]:
        print(f"  sin ficha: {', '.join(r['sin_ficha'][:10])}")
    if r["sin_nombre_en_ficha"]:
        print(f"  ficha sin nombre: {', '.join(r['sin_nombre_en_ficha'][:10])}")


if __name__ == "__main__":
    main()
