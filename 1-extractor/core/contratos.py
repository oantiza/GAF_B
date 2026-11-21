# -*- coding: utf-8 -*-
"""Validación del canónico contra el contrato de BDB.

El SSOT de los esquemas vive en `2-plataforma-datos/contracts/`, e incluye
`canonical/fondosdb-fund.v1` y `canonical/fondosdb-stock.v1`, que describen
exactamente lo que este proyecto escribe en `export_bdb/`. Hasta el 04-09 el
extractor no los referenciaba en ningún sitio: un cambio de forma se detectaba
tres saltos aguas abajo, en el cargador, con el paquete ya generado
(auditoría 03-09, hallazgo 07).

Mismo mecanismo que usa la app (`syncContractsCache.mjs`): los esquemas se
copian a `contracts_cache/` con un manifiesto de SHA-256, y ahí se versionan.
Así el extractor valida aunque la plataforma no esté en la máquina — que es lo
normal en CI, donde son repositorios distintos.

Para actualizar la copia:  python tools/sync_contratos.py
Para comprobarla:          python tools/sync_contratos.py --check

El hash se calcula sobre el contenido con fin de línea LF (ver `normaliza`).
"""
from __future__ import annotations

import functools
import hashlib
import json
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / "contracts_cache"
MANIFEST = CACHE_DIR / "manifest.json"
MANIFEST_VERSION = "bdb-contract-cache.v1"

# Qué contrato aplica a cada salida de `convierte()`.
ESQUEMA_FONDO = "fondosdb-fund.v1.schema.json"
ESQUEMA_ACCION = "fondosdb-stock.v1.schema.json"


class ContratoNoDisponible(RuntimeError):
    """La cache no está o no cuadra con su manifiesto."""


class ContratoInvalido(ValueError):
    """El documento no cumple el contrato."""


def normaliza(contenido: bytes) -> bytes:
    """Fin de línea LF, como `normalizedContract()` de `syncContractsCache.mjs`.

    Git con `core.autocrlf=true` (el valor de sistema en Windows) saca los
    esquemas en CRLF. Con el hash de bytes crudos, en cualquier clon nuevo la
    caché «no cuadraba», `exporta_bdb` se saltaba la validación sin ruido y
    `--check` fallaba (auditoría 16-10, CRIT-08). El manifiesto se calculó
    sobre LF, así que sus hashes siguen valiendo.
    """
    return contenido.replace(b"\r\n", b"\n")


def sha256(contenido: bytes) -> str:
    """SHA-256 del contenido normalizado: el fin de línea no cuenta."""
    return hashlib.sha256(normaliza(contenido)).hexdigest()


def nombres_esquema(directorio: Path) -> list[str]:
    return sorted(p.name for p in directorio.glob("*.schema.json"))


def _lee_json(ruta: Path, que: str):
    """JSON de la caché; si no se puede leer o no es JSON en UTF-8, un error que
    se entiende (revisión de la quinta pasada, MEN-1: antes salía «Expecting
    value: line 1 column 1» o «'utf-8' codec can't decode…»)."""
    try:
        return json.loads(ruta.read_bytes().decode("utf-8"))
    except (OSError, ValueError) as e:   # UnicodeDecodeError y JSONDecodeError son ValueError
        raise ContratoNoDisponible(
            f"la caché de contratos está dañada: {que} {ruta.name} no se puede leer como JSON en UTF-8 "
            f"({type(e).__name__}: {e}). ¿Un merge a medias o un fichero editado a mano?") from e


def verifica_cache() -> int:
    """Comprueba que la copia local cuadra con su manifiesto. Devuelve cuántos."""
    if not MANIFEST.exists():
        raise ContratoNoDisponible(f"Falta el manifiesto: {MANIFEST}")
    manifiesto = _lee_json(MANIFEST, "el manifiesto")
    if (not isinstance(manifiesto, dict) or manifiesto.get("schema_version") != MANIFEST_VERSION
            or not manifiesto.get("files")):
        raise ContratoNoDisponible("Manifiesto de contratos no válido.")
    en_disco = nombres_esquema(CACHE_DIR)
    declarados = sorted(manifiesto["files"])
    if en_disco != declarados:
        raise ContratoNoDisponible("El contenido de la cache no coincide con su manifiesto.")
    for nombre in en_disco:
        _lee_json(CACHE_DIR / nombre, "el esquema")
        contenido = (CACHE_DIR / nombre).read_bytes()
        if sha256(contenido) != manifiesto["files"][nombre]:
            raise ContratoNoDisponible(f"Hash de contrato no coincide: {nombre}")
    return len(en_disco)


@functools.lru_cache(maxsize=8)
def _validador(nombre: str):
    from jsonschema import Draft202012Validator

    ruta = CACHE_DIR / nombre
    if not ruta.exists():
        raise ContratoNoDisponible(
            f"Contrato no encontrado en la cache: {ruta}. "
            "Ejecuta `python tools/sync_contratos.py`."
        )
    return Draft202012Validator(json.loads(ruta.read_text(encoding="utf-8")))


def esquema_para(canonico: dict) -> str:
    """El contrato que corresponde a un canónico ya generado.

    Hasta el 16-10 se miraba `derived.asset_class == "Accion"`, que nunca se
    cumple (las acciones llevan "EQUITY"): funcionaba solo por `ms.stock`
    (auditoría 16-10, BAJA-06). Lo que marca una acción es
    `classification_v2.asset_type == "stock"`."""
    tipo = (canonico.get("classification_v2") or {}).get("asset_type")
    if tipo == "stock" or (canonico.get("ms") or {}).get("stock") is not None:
        return ESQUEMA_ACCION
    return ESQUEMA_FONDO


def valida(canonico: dict, nombre: str | None = None) -> None:
    """Lanza `ContratoInvalido` con las primeras discrepancias, o no hace nada."""
    nombre = nombre or esquema_para(canonico)
    errores = sorted(_validador(nombre).iter_errors(canonico),
                     key=lambda e: list(e.path))
    if not errores:
        return
    muestra = "; ".join(
        f"{'.'.join(str(p) for p in e.path) or '<raiz>'}: {e.message}"
        for e in errores[:5]
    )
    raise ContratoInvalido(f"{nombre} invalido: {muestra}")
