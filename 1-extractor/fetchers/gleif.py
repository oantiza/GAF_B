"""Fuente GLEIF: registro global de identificadores de entidad jurídica (LEI).

La Global Legal Entity Identifier Foundation expone gratis y sin clave la
base de LEI, con la correspondencia ISIN -> LEI que aportan los emisores. Para
un fondo da: LEI, nombre legal, jurisdicción y, por la relación
`fund-manager`, la sociedad gestora legal. Cobertura medida el 04-09 sobre el
universo: 100 % de los ISIN españoles y franceses de la muestra; 0 % de los
luxemburgueses e irlandeses (esas clases no declaran el ISIN a GLEIF).

Dos peticiones como mucho por fondo (registro + gestora), familia identidad
(365 días).
"""
from __future__ import annotations

import logging
from pathlib import Path

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.gleif")

URL = "https://api.gleif.org/api/v1/lei-records"
FAMILIA = "identidad"
ISO3 = {"LU": "LUX", "IE": "IRL", "FR": "FRA", "ES": "ESP", "DE": "DEU", "NL": "NLD",
        "FI": "FIN", "BE": "BEL", "IT": "ITA", "AT": "AUT", "DK": "DNK", "SE": "SWE",
        "PT": "PRT", "LI": "LIE", "GB": "GBR", "CH": "CHE", "MT": "MLT", "NO": "NOR",
        "US": "USA"}


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None) -> dict:
    try:
        r = http.get(URL, params={"filter[isin]": isin.upper()}, force=force, familia=FAMILIA)
    except Exception as e:  # noqa: BLE001
        log.info("GLEIF %s: %s", isin, e)
        return {}
    if not r.ok:
        return {}
    try:
        registros = (r.json() or {}).get("data") or []
    except Exception:  # noqa: BLE001
        return {}
    if not registros:
        log.info("GLEIF: %s sin LEI asociado", isin)
        return {}
    rec = registros[0]
    attrs = rec.get("attributes") or {}
    ent = attrs.get("entity") or {}
    out: dict = {}
    with procedencia.etapa("lei-record", r.fetched_at):
        set_path(out, "identificacion.lei", attrs.get("lei"))
        set_path(out, "identificacion.nombre_legal_lei", (ent.get("legalName") or {}).get("name"))
        juris = (ent.get("legalJurisdiction") or (ent.get("legalAddress") or {}).get("country") or "")
        set_path(out, "identificacion.domicilio", ISO3.get(str(juris)[:2].upper()))
        set_path(out, "identificacion.fecha_constitucion", (ent.get("creationDate") or "")[:10] or None)
        set_path(out, "identificacion.estado_lei", (attrs.get("registration") or {}).get("status"))
    enlace = ((rec.get("relationships") or {}).get("fund-manager") or {}).get("links") or {}
    url_gestora = enlace.get("related")
    if url_gestora:
        try:
            r2 = http.get(url_gestora, force=force, familia=FAMILIA)
            if r2.ok:
                d2 = (r2.json() or {}).get("data") or {}
                e2 = ((d2.get("attributes") or {}).get("entity") or {})
                with procedencia.etapa("fund-manager", r2.fetched_at):
                    set_path(out, "identificacion.gestora_legal", (e2.get("legalName") or {}).get("name"))
                    set_path(out, "identificacion.gestora_lei", (d2.get("attributes") or {}).get("lei"))
        except Exception as e:  # noqa: BLE001
            log.debug("GLEIF gestora %s: %s", isin, e)
    return out


# ------------------------------------------------------------------ por LEI
#: Un LEI es 18 caracteres alfanuméricos y dos dígitos de control (ISO 17442).
RE_LEI = r"^[A-Z0-9]{18}[0-9]{2}$"


def registro_por_lei(lei: str, http, force: bool = False) -> dict:
    """Lo que GLEIF dice de una entidad por su LEI: una petición, familia identidad.

    Es la otra mitad de la regla «un LEI, un emisor» (decisión 8 de
    `DECISIONES_DATOS_2026-11-07.md`): el LEI lo pone FIRDS en cada acción, y aquí se le pone
    nombre legal, país y estado a la entidad, sin casar ningún nombre.

    Devuelve siempre un dict con `resuelto`: `True` y los campos, o `False` y `motivo`. No
    lanza: una entidad que no se puede consultar se cuenta y se dice, no tumba la pasada. Lo
    que separa «GLEIF no lo conoce» (404, `motivo: no_existe`) de «no se ha podido preguntar»
    (red, caché sin entrada, error del servidor) es justo lo que hace falta para saber si
    volver a intentarlo.

    El país es el de la **jurisdicción legal** (`entity.jurisdiction`, en la API v1; algunas
    respuestas antiguas la llaman `legalJurisdiction`), y solo si no la trae, el de la
    dirección legal. Es el país donde está constituida la entidad, que es lo que dice el
    contrato `issuer.v2`, y no el de su sede: Ferrovial cotiza en Madrid y está constituida en
    Países Bajos. Una jurisdicción subnacional (`US-DE`, Delaware) da su país, `US`, y la
    completa se conserva en `jurisdiccion`.
    """
    import re

    lei = str(lei or "").strip().upper()
    if not re.match(RE_LEI, lei):
        return {"lei": lei, "resuelto": False, "motivo": "no_es_un_lei"}
    try:
        r = http.get(f"{URL}/{lei}", force=force, familia=FAMILIA)
    except Exception as e:  # noqa: BLE001  (SinCache, red caída, reintentos agotados)
        log.info("GLEIF %s: %s", lei, e)
        return {"lei": lei, "resuelto": False, "motivo": f"sin_respuesta: {type(e).__name__}"}
    if r.status == 404:
        return {"lei": lei, "resuelto": False, "motivo": "no_existe"}
    if not r.ok:
        return {"lei": lei, "resuelto": False, "motivo": f"http_{r.status}"}
    try:
        attrs = (((r.json() or {}).get("data") or {}).get("attributes")) or {}
    except Exception:  # noqa: BLE001
        return {"lei": lei, "resuelto": False, "motivo": "respuesta_ilegible"}
    ent = attrs.get("entity") or {}
    reg = attrs.get("registration") or {}
    nombre = str((ent.get("legalName") or {}).get("name") or "").strip()
    juris = str(ent.get("jurisdiction") or ent.get("legalJurisdiction") or "").strip().upper()
    pais_dir = str((ent.get("legalAddress") or {}).get("country") or "").strip().upper()
    pais = juris[:2] if re.match(r"^[A-Z]{2}(-|$)", juris) else pais_dir[:2]
    if str(attrs.get("lei") or "").upper() != lei:
        return {"lei": lei, "resuelto": False, "motivo": "respuesta_de_otro_lei"}
    if not nombre:
        return {"lei": lei, "resuelto": False, "motivo": "sin_nombre_legal"}
    if not re.match(r"^[A-Z]{2}$", pais):
        return {"lei": lei, "resuelto": False, "motivo": "sin_pais"}
    import datetime as _dt
    return {
        "lei": lei,
        "resuelto": True,
        "nombre_legal": nombre,
        "pais": pais,
        "pais_origen": "jurisdiccion" if juris[:2] == pais else "direccion_legal",
        "jurisdiccion": juris or None,
        "estado_registro": reg.get("status") or None,
        "estado_entidad": ent.get("status") or None,
        "gleif_actualizado": (reg.get("lastUpdateDate") or "")[:10] or None,
        "consultado": _dt.datetime.fromtimestamp(r.fetched_at, _dt.timezone.utc).date().isoformat()
        if getattr(r, "fetched_at", None) else None,
    }
