"""Fuente CSSF (Luxemburgo): identificadores oficiales de UCITS, compartimentos
y clases. Solo ISIN LU.

La CSSF publica un fichero (`OPC_COMP_TP_TOUS_OUVERTS.zip`, CSV UTF-16 de
~150.000 clases) con, por ISIN: nombre legal del paraguas, del compartimento y
de la clase, divisa del compartimento y fecha de autorización. Cubre 481 de
los 482 fondos luxemburgueses del universo (medido el 04-09). Es la lista de
UCITS (parte I de la ley de 2010), así que estar en ella es ser UCITS.

Una descarga al mes (el nombre del fichero local lleva el mes) y un índice
compacto en cache/cssf/ para no releer 200 MB por fondo.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import logging
import zipfile
from pathlib import Path

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.cssf")

ZIP_URL = "https://www.cssf.lu/wp-content/uploads/OPC_COMP_TP_TOUS_OUVERTS.zip"
FAMILIA = "regulatorio"
COMPARTIMENTO_VIRTUAL = "compartiment virtuel"

_INDICE: dict[str, dict] | None = None
_INDICE_PERIODO: str | None = None


def _periodo() -> str:
    return dt.date.today().strftime("%Y-%m")


def indice(http, base: Path, force: bool = False) -> dict[str, dict]:
    """{ISIN: fila} del fichero del mes; se construye una vez por proceso."""
    global _INDICE, _INDICE_PERIODO
    periodo = _periodo()
    if _INDICE is not None and _INDICE_PERIODO == periodo:
        return _INDICE
    carpeta = base / "cache" / "cssf"
    carpeta.mkdir(parents=True, exist_ok=True)
    json_idx = carpeta / f"indice_{periodo}.json"
    if json_idx.exists() and not force:
        _INDICE = json.loads(json_idx.read_text(encoding="utf-8"))
        _INDICE_PERIODO = periodo
        return _INDICE
    destino = carpeta / f"OPC_COMP_TP_TOUS_OUVERTS_{periodo}.zip"
    if not destino.exists():
        anteriores = sorted(carpeta.glob("OPC_COMP_TP_TOUS_OUVERTS_*.zip"))
        if getattr(http, "sin_red", False) or (getattr(http, "sin_caducidad", False) and anteriores):
            if not anteriores:
                _INDICE, _INDICE_PERIODO = {}, periodo
                return _INDICE
            destino = anteriores[-1]
            log.info("CSSF: sin red, uso %s", destino.name)
        else:
            http.download(ZIP_URL, destino, force=force)
    _INDICE = parsea_zip(destino)
    _INDICE_PERIODO = periodo
    json_idx.write_text(json.dumps(_INDICE, ensure_ascii=False), encoding="utf-8")
    log.info("CSSF: índice de %s clases (%s)", len(_INDICE), destino.name)
    return _INDICE


def parsea_zip(ruta: Path) -> dict[str, dict]:
    with zipfile.ZipFile(ruta) as z:
        nombre = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        raw = z.read(nombre)
    return parsea_csv(raw)


def parsea_csv(raw: bytes) -> dict[str, dict]:
    """CSV UTF-16 con cabecera, línea de guiones y columnas separadas por tabulador."""
    texto = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "replace")
    lineas = io.StringIO(texto).read().splitlines()
    if len(lineas) < 3:
        return {}
    cabecera = [h.strip() for h in lineas[0].split("\t")]
    out: dict[str, dict] = {}
    for ln in lineas[2:]:
        partes = [x.strip() for x in ln.split("\t")]
        if len(partes) < len(cabecera) - 1:
            continue
        fila = dict(zip(cabecera, partes))
        isin = fila.get("ISIN", "")
        if len(isin) == 12:
            out[isin] = {
                "opc": fila.get("NOMOPC") or None,
                "compartimento": fila.get("NOMCOMPARTIMENT") or None,
                "clase": fila.get("NOMTYPEPART") or None,
                "autorizacion": _fecha(fila.get("AGREEMENTCOMP")),
                "divisa": fila.get("DEVISECOMP") or None,
                "estado": fila.get("E") or None,
            }
    return out


def _fecha(v: str | None) -> str | None:
    if not v or "/" not in v:
        return None
    d, m, y = v.split("/")[:3]
    try:
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except ValueError:
        return None


def nombre_legal(fila: dict) -> str | None:
    """`PARAGUAS-COMPARTIMENTO`, tal como lo indexa el registro de ESMA."""
    opc, comp = fila.get("opc"), fila.get("compartimento")
    if not opc:
        return None
    if comp and not comp.lower().startswith(COMPARTIMENTO_VIRTUAL):
        return f"{opc}-{comp}"
    return opc


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None) -> dict:
    if not isin.upper().startswith("LU"):
        return {}
    base = Path(base) if base else Path(__file__).resolve().parent.parent
    fila = indice(http, base, force).get(isin.upper())
    if not fila:
        log.info("CSSF: %s no está en el fichero de identificadores", isin)
        return {}
    out: dict = {}
    periodo = _INDICE_PERIODO
    with procedencia.etapa("identificadores", None, fichero=periodo):
        set_path(out, "identificacion.ucits", True)
        set_path(out, "identificacion.domicilio", "LUX")
        set_path(out, "identificacion.paraguas_legal", fila.get("opc"))
        comp = fila.get("compartimento")
        if comp and not comp.lower().startswith(COMPARTIMENTO_VIRTUAL):
            set_path(out, "identificacion.compartimento_legal", comp)
        set_path(out, "identificacion.clase_legal", fila.get("clase"))
        legal = nombre_legal(fila)
        set_path(out, "identificacion.nombre_legal_registro", legal)
        # Nombre de respaldo (paraguas-compartimento clase): solo rellena si
        # Morningstar no da el comercial, para que la ficha no se quede sin nombre.
        if legal:
            set_path(out, "identificacion.nombre", " ".join(x for x in (legal, fila.get("clase")) if x))
        set_path(out, "identificacion.divisa_compartimento", fila.get("divisa"))
        set_path(out, "identificacion.fecha_autorizacion_cssf", fila.get("autorizacion"))
        set_path(out, "meta.cssf_fichero", periodo)
    return out
