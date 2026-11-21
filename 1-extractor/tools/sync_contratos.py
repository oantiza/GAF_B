#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copia los contratos canónicos desde el SSOT y verifica la copia local.

El SSOT es `2-plataforma-datos/contracts/canonical/`. Este proyecto guarda una
copia en `contracts_cache/` con un manifiesto de SHA-256, para poder validar sin
tener la plataforma delante (en CI son repositorios distintos).

    python tools/sync_contratos.py            # copia desde el SSOT
    python tools/sync_contratos.py --check    # comprueba, no escribe

Con `--check` y sin SSOT a la vista, se limita a verificar la copia contra su
propio manifiesto. Es el mismo diseño que `syncContractsCache.mjs` en la app,
también en que hashes, copia y comparación van sobre el contenido con fin de
línea LF: un checkout con `core.autocrlf=true` no cuenta como cambio.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from core.contratos import (  # noqa: E402
    CACHE_DIR,
    MANIFEST,
    MANIFEST_VERSION,
    nombres_esquema,
    normaliza,
    sha256,
    verifica_cache,
)

SSOT_POR_DEFECTO = RAIZ.parent / "2-plataforma-datos" / "contracts" / "canonical"


def ssot() -> Path:
    return Path(os.environ.get("BDB_CONTRACTS_CANONICAL", SSOT_POR_DEFECTO))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="comprobar sin escribir")
    args = parser.parse_args()

    origen = ssot()
    if not origen.exists():
        if not args.check:
            raise SystemExit(f"No existe el SSOT de contratos: {origen}")
        n = verifica_cache()
        print(f"Contratos verificados por manifiesto: {n} esquemas en {CACHE_DIR}")
        return 0

    esquemas = nombres_esquema(origen)
    if not esquemas:
        raise SystemExit(f"No hay *.schema.json en {origen}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for nombre in esquemas:
        # Todo sobre el contenido normalizado a LF: un checkout con CRLF (en el
        # SSOT o en la cache) no es una cache desactualizada (CRIT-08).
        contenido = normaliza((origen / nombre).read_bytes())
        hashes[nombre] = sha256(contenido)
        destino = CACHE_DIR / nombre
        if args.check:
            if not destino.exists() or normaliza(destino.read_bytes()) != contenido:
                raise SystemExit(f"Cache de contrato desactualizada: {nombre}")
        else:
            destino.write_bytes(contenido)

    ajenos = [n for n in nombres_esquema(CACHE_DIR) if n not in hashes]
    if ajenos:
        raise SystemExit(f"La cache tiene esquemas ajenos al SSOT: {', '.join(ajenos)}")

    manifiesto = {
        "schema_version": MANIFEST_VERSION,
        "source": "2-plataforma-datos/contracts/canonical",
        "files": dict(sorted(hashes.items())),
    }
    if args.check:
        actual = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else None
        if actual != manifiesto:
            raise SystemExit("El manifiesto de la cache no coincide con el SSOT.")
        verifica_cache()
        print(f"Contratos comparados con el SSOT: {len(esquemas)} esquemas en {CACHE_DIR}")
    else:
        MANIFEST.write_text(json.dumps(manifiesto, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8", newline="\n")
        print(f"Contratos sincronizados: {len(esquemas)} esquemas -> {CACHE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
