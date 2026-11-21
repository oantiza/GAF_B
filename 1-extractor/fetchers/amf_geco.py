"""Fuente AMF GECO (Francia): base oficial de organismos de inversión colectiva.

La AMF publica desde 2025 la base GECO, con una API interna que la propia web
consume (`/back-office`). Por ISIN da el compartimento (gestora y su LEI,
país, naturaleza OPCVM=UCITS/FIA, depositario, fecha de creación y de
agrément, clasificación AMF) y la clase (fecha de creación, divisa, política
de distribución) con sus documentos: el DIC/KID en PDF, que se parsea con
`core.kid`. Solo ISIN FR.

Peticiones: búsqueda por ISIN, clase, lista de clases (documentos) y el PDF.
Familia regulatorio (90 días).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from core import kid
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.amf_geco")

BASE_URL = "https://geco.amf-france.org/back-office"
FAMILIA = "regulatorio"
CABECERAS = {"Accept": "application/json", "Origin": "https://geco.amf-france.org",
             "Referer": "https://geco.amf-france.org/"}
FILTROS = ("cmpNom", "gestionnaire", "prdDomcltnLib", "prdFamlLib", "prdNatureLib",
           "prdSsNatureLib", "numDernAuto", "lei")
DISTRIBUCION = {"C": "acumulacion", "D": "distribucion", "M": "mixta"}


def _post_json(http, url: str, params: dict, cuerpo: dict, force: bool):
    """POST JSON con la misma caché/ritmo que un GET (clave por URL+cuerpo)."""
    return http.post_json(url, params=params, cuerpo=cuerpo, headers=CABECERAS,
                          force=force, familia=FAMILIA)


def busca_compartimento(http, isin: str, force: bool = False):
    filtros = {k: {"value": None, "matchMode": "startsWith"} for k in FILTROS}
    filtros["cmpCodeParPrincp"] = {"value": isin, "matchMode": "startsWith"}
    cuerpo = {"first": 0, "rows": 10, "sortOrder": 1, "filters": filtros, "globalFilter": None}
    r = _post_json(http, f"{BASE_URL}/funds/getCompartmentsBycriteria",
                   {"productType": "FR", "idThirdParty": 0}, cuerpo, force)
    if not r.ok:
        return None, r
    try:
        comps = (r.json() or {}).get("compartmentDtos") or []
    except Exception:  # noqa: BLE001
        return None, r
    for c in comps:
        if str(c.get("cmpCodeParPrincp", "")).upper() == isin.upper():
            return c, r
    return (comps[0] if comps else None), r


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None) -> dict:
    if not isin.upper().startswith("FR"):
        return {}
    base = Path(base) if base else Path(__file__).resolve().parent.parent
    try:
        comp, r = busca_compartimento(http, isin, force)
    except Exception as e:  # noqa: BLE001
        log.info("GECO %s: %s", isin, e)
        return {}
    if not comp:
        log.info("GECO: %s no encontrado", isin)
        return {}
    out: dict = {}
    with procedencia.etapa("compartimento", r.fetched_at):
        set_path(out, "identificacion.ucits", comp.get("prdFaml") == "OPCVM")
        set_path(out, "identificacion.marco_legal", comp.get("prdFamlLib"))
        set_path(out, "identificacion.domicilio", "FRA")
        set_path(out, "identificacion.gestora_legal", comp.get("gestionnaire"))
        ges = comp.get("gestionnaireAssocie") or {}
        set_path(out, "identificacion.gestora_lei", ges.get("codeLei"))
        set_path(out, "identificacion.lei", comp.get("lei"))
        set_path(out, "identificacion.nombre_legal_registro", comp.get("cmpNom"))
        set_path(out, "identificacion.depositario", comp.get("nomDepositaire"))
        set_path(out, "identificacion.fecha_creacion_compartimento", comp.get("cmpDateCreation"))
        set_path(out, "identificacion.fecha_autorizacion_amf", comp.get("dateDernAuto"))
        set_path(out, "identificacion.numero_autorizacion_amf", comp.get("numDernAuto"))
        set_path(out, "identificacion.clasificacion_amf", comp.get("cmpClssFndAmfLib"))
        set_path(out, "identificacion.forma_juridica", comp.get("prdSsNatureLib"))
        set_path(out, "meta.geco_id", comp.get("cmpId"))

    cmp_id = comp.get("cmpId")
    try:
        r2 = http.get(f"{BASE_URL}/funds/shareByCmpCodeParPrincp/{isin.upper()}",
                      headers=CABECERAS, force=force, familia=FAMILIA)
        clase = r2.json() if r2.ok and r2.text.strip().startswith("{") else {}
    except Exception:  # noqa: BLE001
        clase = {}
    if clase:
        with procedencia.etapa("clase", r2.fetched_at):
            set_path(out, "identificacion.fecha_lanzamiento_clase", clase.get("parDateCreation"))
            set_path(out, "identificacion.clase_legal", clase.get("parNom"))
            # Nombre de respaldo si Morningstar no da el comercial.
            if comp.get("cmpNom"):
                set_path(out, "identificacion.nombre",
                         " ".join(x for x in (comp.get("cmpNom"), clase.get("parNom")) if x))
            set_path(out, "identificacion.divisa_base", clase.get("parRefDevCode"))
            set_path(out, "identificacion.politica_distribucion",
                     DISTRIBUCION.get(clase.get("parAffctnRevnuCode")))
            set_path(out, "meta.geco_clase_id", clase.get("parId"))

    if cmp_id:
        _documentos(isin, cmp_id, http, base, force, out)
    return out


def _documentos(isin: str, cmp_id: str, http, base: Path, force: bool, out: dict) -> None:
    try:
        r = http.get(f"{BASE_URL}/funds/compartment/{cmp_id}/shares", headers=CABECERAS,
                     force=force, familia=FAMILIA)
        clases = r.json() if r.ok and r.text.strip().startswith("[") else []
    except Exception as e:  # noqa: BLE001
        log.debug("GECO documentos %s: %s", isin, e)
        return
    doc = None
    for c in clases:
        if str(c.get("isin", "")).upper() != isin.upper():
            continue
        docs = [d for d in (c.get("documentEsEntities") or [])
                if "DIC" in str(d.get("docTypeLib", "")).upper() or "KID" in str(d.get("docTypeLib", "")).upper()]
        docs.sort(key=lambda d: d.get("dateEffet") or "", reverse=True)
        doc = docs[0] if docs else None
        break
    if not doc or not doc.get("idInterne"):
        return
    # La web descarga por el id interno del documento (`/document/download/`),
    # no por `docId` (verificado el 04-09: docId devuelve 500).
    url = f"{BASE_URL}/document/download/{doc['idInterne']}"
    destino = base / "cache" / "kid" / "amf" / f"{isin.upper()}_{doc['idInterne']}.pdf"
    try:
        if getattr(http, "sin_red", False) and not destino.exists():
            return
        http.download(url, destino, force=force)
        datos = kid.parsea_pdf(destino, isin)
    except Exception as e:  # noqa: BLE001
        log.warning("GECO KID %s: %s", isin, e)
        return
    if datos.get("isin") and datos["isin"] != isin.upper():
        log.warning("GECO KID %s: el PDF habla de %s; no lo uso", isin, datos["isin"])
        return
    with procedencia.etapa("kid", destino.stat().st_mtime, url=url, documento=doc.get("dateEffet")):
        set_path(out, "riesgo.sri_kid_1a7", datos.get("sri"))
        set_path(out, "riesgo.kid_periodo_mantenimiento_anos", datos.get("periodo_mantenimiento_anos"))
        for k, v in (datos.get("costes") or {}).items():
            set_path(out, f"costes.kid.{k}", v)
        set_path(out, "costes.kid.fecha", datos.get("fecha_documento") or doc.get("dateEffet"))
        set_path(out, "costes.kid.idioma", datos.get("idioma"))
        set_path(out, "documentos_oficiales.kid_url", url)
        set_path(out, "documentos_oficiales.kid_fecha", datos.get("fecha_documento") or doc.get("dateEffet"))
        set_path(out, "documentos_oficiales.kid_sha256", datos.get("texto_sha256"))
        set_path(out, "identificacion.productor_kid", datos.get("productor"))
        set_path(out, "esg.sfdr_articulo", datos.get("sfdr_articulo"))
    json_meta = destino.with_suffix(".json")
    try:
        json_meta.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass
