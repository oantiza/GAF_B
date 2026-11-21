"""Fuente ESMA: registro de comercialización transfronteriza de UCITS y FIA.

ESMA publica (Reglamento (UE) 2019/1156) la base de fondos notificados para
comercialización transfronteriza, consultable como índice Solr en JSON:
nombre nacional, marco legal (UCITS/AIF), sociedad gestora, domicilio, estado
y países donde se comercializa. El registro no indexa por ISIN, así que se
busca por nombre: con el nombre legal `PARAGUAS-COMPARTIMENTO` de la CSSF
(30/30 coincidencias únicas en la muestra del 04-09) o, en su defecto, por
los tokens del nombre de Morningstar acotados al domicilio del ISIN.

Solo se acepta una coincidencia cuando es única o claramente la mejor, y
siempre del domicilio que dice el ISIN; ante la duda, nada.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from pathlib import Path

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.esma")

URL = "https://registers.esma.europa.eu/solr/esma_registers_funds_cbdif/select"
FAMILIA = "regulatorio"
CAMPOS = ("funds_national_name,funds_legal_framework_name,funds_manager_nat_name,"
          "funds_domicile_cou_code,funds_status_code_name,funds_host_country_codes,"
          "funds_ca_cou_code,funds_mgmnt_status_code_name,funds_last_update_date")
ISO3 = {"LU": "LUX", "IE": "IRL", "FR": "FRA", "ES": "ESP", "DE": "DEU", "NL": "NLD",
        "FI": "FIN", "BE": "BEL", "IT": "ITA", "AT": "AUT", "DK": "DNK", "SE": "SWE",
        "PT": "PRT", "LI": "LIE", "GB": "GBR", "CH": "CHE", "MT": "MLT", "NO": "NOR",
        "PL": "POL", "CZ": "CZE", "GR": "GRC", "HU": "HUN", "IS": "ISL", "EE": "EST",
        "LT": "LTU", "LV": "LVA", "SK": "SVK", "SI": "SVN", "CY": "CYP", "BG": "BGR",
        "RO": "ROU", "HR": "HRV"}
PALABRAS_VACIAS = {"fund", "funds", "plc", "sicav", "fcp", "ucits", "etf", "the", "of", "and",
                   "class", "acc", "inc", "dis", "dist", "eur", "usd", "gbp", "chf", "jpy",
                   "hedged", "h", "a", "b", "c", "d", "e", "i", "r", "z", "p", "n", "t", "x",
                   "shares", "share", "cap", "distributing", "accumulating", "accumulation",
                   "capitalisation", "capitalization", "unhedged", "retail", "institutional",
                   "part", "parts", "clase", "eu", "ii", "iii", "iv", "portfolio", "fi", "lux",
                   "sa", "sl", "nv", "oyj", "ab", "ag", "ltd", "limited"}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower())


def tokens(nombre: str) -> list[str]:
    return [t for t in _norm(nombre).split() if t not in PALABRAS_VACIAS and len(t) > 1]


GENERICAS = {"fund", "funds", "plc", "sicav", "fcp", "ucits", "the", "of", "and", "eu"}


def tokens_estrictos(nombre: str) -> set[str]:
    """Todas las palabras salvo las genéricas: aquí una letra de clase («S»,
    «I») sí cuenta, porque distingue compartimentos."""
    return {t for t in _norm(nombre).split() if t not in GENERICAS}


def _consulta(http, q: str, force: bool, rows: int = 5) -> list[dict]:
    r = http.get(URL, params={"q": q, "rows": rows, "wt": "json", "fl": CAMPOS},
                 force=force, familia=FAMILIA)
    if not r.ok:
        return []
    try:
        return list((r.json().get("response") or {}).get("docs") or []), r
    except Exception:  # noqa: BLE001
        return [], r


def _escapa(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def busca(http, isin: str, nombre_registro: str | None, nombre_comercial: str | None,
          force: bool = False) -> tuple[dict | None, dict]:
    """(doc, diagnóstico). Exacto por nombre de registro; si no, por tokens."""
    pais = isin[:2].upper()
    diag: dict = {"pais": pais}
    if nombre_registro:
        docs, r = _consulta(http, f'funds_national_name:"{_escapa(nombre_registro)}"', force)
        docs = [d for d in docs if d.get("funds_domicile_cou_code") == pais]
        diag.update(modo="exacto", consulta=nombre_registro, candidatos=len(docs))
        if len(docs) == 1:
            return docs[0], diag | {"fetched_at": r.fetched_at}
    if nombre_comercial:
        toks = tokens(nombre_comercial)[:6]
        if len(toks) >= 2:
            comodin = "*" + "*".join(toks) + "*"
            q = f"funds_domicile_cou_code:{pais} AND funds_national_name:{comodin}"
            docs, r = _consulta(http, q, force, rows=10)
            diag.update(modo="tokens", consulta=comodin, candidatos=len(docs))
            elegido = _mejor(docs, toks, nombre_comercial)
            if elegido:
                return elegido, diag | {"fetched_at": r.fetched_at}
    return None, diag


def _mejor(docs: list[dict], toks: list[str], nombre_consulta: str = "") -> dict | None:
    if not docs:
        return None
    activos = [d for d in docs if d.get("funds_status_code_name") == "Active"] or docs
    if len(activos) == 1:
        return activos[0]
    estrictos_consulta = tokens_estrictos(nombre_consulta) if nombre_consulta else set(toks)
    puntuados = []
    contenidos = []
    for d in activos:
        nombre = d.get("funds_national_name", "")
        propios = set(tokens(nombre))
        comunes = len(set(toks) & propios)
        # El nombre del registro cabe entero en el comercial y no le sobra ni
        # una letra de clase: «Comgest Growth Europe» sí, «Comgest Growth
        # Europe S» no.
        if comunes == len(toks) and tokens_estrictos(nombre) <= estrictos_consulta:
            contenidos.append(d)
        # penaliza los tokens ajenos: «Europe ex UK» no es «Europe»
        puntuados.append((comunes - 0.5 * len(tokens_estrictos(nombre) - estrictos_consulta), d))
    if len(contenidos) == 1:
        return contenidos[0]
    puntuados.sort(key=lambda x: -x[0])
    if len(puntuados) >= 2 and puntuados[0][0] - puntuados[1][0] < 0.75:
        return None  # empate: no se adivina
    return puntuados[0][1]


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None, previo: dict | None = None) -> dict:
    previo = previo or {}
    pais = isin[:2].upper()
    if pais not in ISO3:
        return {}
    if pais == "ES":
        # Un fondo español rara vez se notifica a otros países y la CNMV ya da
        # marco, gestora y domicilio: la consulta costaría una petición inútil.
        return {}
    cssf = (previo.get("cssf") or {}).get("identificacion") or {}
    ms = (previo.get("morningstar_lt") or {}).get("identificacion") or {}
    anterior = (previo.get("_anterior") or {}).get("identificacion") or {}
    nombre_registro = cssf.get("nombre_legal_registro")
    # Si Morningstar no responde, vale el nombre de la ficha ya guardada.
    nombre_comercial = ms.get("nombre") or anterior.get("nombre")
    if not nombre_registro and not nombre_comercial:
        log.info("ESMA %s: sin nombre con el que buscar", isin)
        return {}
    try:
        doc, diag = busca(http, isin, nombre_registro, nombre_comercial, force)
    except Exception as e:  # noqa: BLE001
        log.info("ESMA %s: %s", isin, e)
        return {}
    if not doc:
        log.info("ESMA %s: sin coincidencia (%s)", isin, diag)
        return {}
    out: dict = {}
    with procedencia.etapa("cbdif", diag.get("fetched_at"), consulta=diag.get("consulta"),
                           modo=diag.get("modo")):
        marco = doc.get("funds_legal_framework_name")
        if marco:
            set_path(out, "identificacion.ucits", marco == "UCITS")
            set_path(out, "identificacion.marco_legal", marco)
        gestora = doc.get("funds_manager_nat_name")
        if gestora and gestora.upper() != "N/A":
            set_path(out, "identificacion.gestora_legal", gestora)
        set_path(out, "identificacion.domicilio", ISO3.get(doc.get("funds_domicile_cou_code")))
        set_path(out, "identificacion.nombre_legal_esma", doc.get("funds_national_name"))
        # Nombre de respaldo si ni Morningstar ni el registro nacional dan uno.
        set_path(out, "identificacion.nombre", doc.get("funds_national_name"))
        set_path(out, "identificacion.estado_registro_esma", doc.get("funds_status_code_name"))
        hosts = doc.get("funds_host_country_codes") or []
        set_path(out, "identificacion.comercializado_en_espana",
                 pais == "ES" or "ES" in hosts)
        set_path(out, "identificacion.paises_comercializacion", sorted(hosts) or None)
        set_path(out, "meta.esma_coincidencia", {k: v for k, v in diag.items() if k != "fetched_at"})
    return out
