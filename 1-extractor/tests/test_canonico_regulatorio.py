# -*- coding: utf-8 -*-
"""El canónico lleva el bloque regulatorio y la procedencia de cada campo.

Hasta el 04-09 el canónico no traía ni el SRI del KID ni los costes ex-ante:
las dos cifras que un asesor tiene que poder enseñar llegaban a la app por
otra vía, también Morningstar. Ahora van en `regulatory`, con independencia de
quién las haya aportado, y `provenance` dice quién fue. Todo dentro del
contrato fondosdb-fund.v1 (admite propiedades adicionales).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad, contratos  # noqa: E402
from core.adaptador_bdb import convierte  # noqa: E402
from tests.test_adaptador_validacion import _fondo_sano  # noqa: E402


def _fondo_con_regulatorio():
    d = _fondo_sano()
    d["meta"]["isin"] = "ES0110407006"
    d["identificacion"].update({
        "ucits": True, "domicilio": "ESP", "gestora": "Andbank",
        "gestora_legal": "ANDBANK WEALTH MANAGEMENT, SGIIC, S.A.", "registro_cnmv": "5206",
        "fecha_registro_cnmv": "2017-10-16", "vocacion_cnmv": "Renta Variable Mixta Internacional",
        "fecha_emision_isin": "2017-10-16", "fecha_lanzamiento_clase": "2018-10-26",
        "depositario": "BANCO INVERSIS, S.A.",
    })
    d["riesgo"].update({"sri_kid_1a7": 4, "kid_periodo_mantenimiento_anos": 5})
    d["costes"]["kid"] = {"entrada_pct": 0.0, "salida_pct": 0.0, "gestion_y_otros_pct": 1.47,
                          "transaccion_pct": 0.01, "rendimiento_pct": 0.0, "fecha": "2026-01-01",
                          "idioma": "es"}
    d["costes"]["cnmv"] = {"periodo": "2025-12", "periodo_meses": 6, "ter_trimestre_pct": 0.37,
                           "ter_12m_pct": 1.47, "comision_gestion_periodo_pct": 0.68}
    d["cartera"]["cnmv"] = {"fecha": "2025-12-31", "num_posiciones": 24, "peso_top10_pct": 65.52,
                            "patrimonio_total_eur": 9090407.0, "rotacion_pct": 0.1,
                            "top10_posiciones": [{"nombre": "INDITEX", "isin": "ES0148396007",
                                                  "peso_pct": 7.9, "divisa": "EUR",
                                                  "tipo": "Renta Variable Cotizada"}]}
    d["documentos_oficiales"] = {"kid_url": "https://www.cnmv.es/webservices/verdocumento/ver?e=x",
                                 "kid_fecha": "2026-01-01", "kid_sha256": "abc"}
    d["meta"]["procedencia"] = {
        "identificacion.nombre": "morningstar_lt:snapshot",
        "identificacion.categoria_morningstar": "morningstar_lt:screener",
        "identificacion.ucits": "cnmv_ficha:ficha", "identificacion.domicilio": "cnmv_ficha:ficha",
        "identificacion.gestora": "morningstar_lt:snapshot", "identificacion.gestora_legal": "cnmv:zip_mensual",
        "identificacion.registro_cnmv": "cnmv:zip_mensual", "identificacion.fecha_registro_cnmv": "cnmv_ficha:ficha",
        "identificacion.vocacion_cnmv": "cnmv:zip_trimestral", "identificacion.fecha_emision_isin": "cnmv_ficha:ancv",
        "identificacion.fecha_lanzamiento_clase": "morningstar_lt:screener",
        "identificacion.depositario": "cnmv_ficha:ficha",
        "riesgo.sri_kid_1a7": "cnmv_ficha:kid", "riesgo.kid_periodo_mantenimiento_anos": "cnmv_ficha:kid",
        "costes.ter_pct": "morningstar_lt:screener",
        "costes.kid.gestion_y_otros_pct": "cnmv_ficha:kid", "costes.kid.transaccion_pct": "cnmv_ficha:kid",
        "costes.kid.fecha": "cnmv_ficha:kid",
        "costes.cnmv.ter_12m_pct": "cnmv:zip_trimestral",
        "cartera.cnmv.fecha": "cnmv:zip_trimestral", "cartera.cnmv.top10_posiciones": "cnmv:zip_trimestral",
        "documentos_oficiales.kid_url": "cnmv_ficha:ficha",
    }
    d["meta"]["adquisicion"] = {"plan": ["cnmv", "cnmv_ficha", "morningstar_lt"],
                                "fuentes": {"cnmv_ficha": {"hojas": 12, "endpoints": {
                                    "cnmv_ficha:kid": {"fetched_at": "2026-09-04T21:00:00+00:00"}}}}}
    return d


def _convierte(d):
    calidad.aplica(d)
    return convierte(d)


def test_el_bloque_regulatorio_lleva_sri_costes_del_kid_y_registros():
    c = _convierte(_fondo_con_regulatorio())
    reg = c["regulatory"]

    assert reg["sri"] == 4
    assert reg["ucits"] is True and reg["domicile"] == "ESP"
    assert reg["kid"]["costs"] == {"entry_pct": 0.0, "exit_pct": 0.0, "management_and_other_pct": 1.47,
                                   "transaction_pct": 0.01, "performance_fee_pct": 0.0}
    assert reg["kid"]["date"] == "2026-01-01" and reg["kid"]["recommended_holding_years"] == 5
    assert reg["kid"]["source"] == "cnmv_ficha"   # derivado de la procedencia cuando no hay kid_fuente
    assert reg["management_company"] == "Andbank"
    assert reg["management_company_legal"].startswith("ANDBANK WEALTH")
    assert reg["registers"]["cnmv"]["number"] == "5206"
    assert reg["registers"]["cnmv"]["vocation"] == "Renta Variable Mixta Internacional"
    assert reg["periodic_report"]["top10"][0]["name"] == "INDITEX"
    assert reg["periodic_report"]["ter_12m_pct"] == 1.47
    assert reg["isin_issue_date"] == "2017-10-16"


def test_la_procedencia_del_canonico_dice_quien_escribio_cada_campo():
    c = _convierte(_fondo_con_regulatorio())
    prov = c["provenance"]

    assert prov["fields"]["regulatory.sri"] == "cnmv_ficha:kid"
    assert prov["fields"]["regulatory.ucits"] == "cnmv_ficha:ficha"
    assert prov["fields"]["ms.category_morningstar"] == "morningstar_lt:screener"
    assert prov["fields"]["name"] == "morningstar_lt:snapshot"
    assert prov["fields"]["regulatory.periodic_report"] == "cnmv:zip_trimestral"
    assert prov["sources"]["cnmv_ficha"]["canonical_fields"] >= 4
    assert prov["endpoints"]["cnmv_ficha:kid"]["fetched_at"].startswith("2026-09-04")
    dep = prov["dependency"]
    assert dep["regulatory_fields"] >= 8
    assert dep["regulatory_from_official_sources"] >= 6
    assert dep["from_morningstar_only"] >= 2


def test_mifid_ongoing_cae_al_kid_solo_si_falta_el_emt():
    d = _fondo_con_regulatorio()
    c = _convierte(d)
    assert c["ms"]["costs"]["mifid_ongoing"] == 1.47
    assert "mifid_ongoing_from_kid" in c["validation"]["warnings"]

    d2 = _fondo_con_regulatorio()
    d2["costes"]["mifid_emt_exante"] = {"corrientes_pct": 1.4946, "fecha": "2026-03-31"}
    c2 = _convierte(d2)
    assert c2["ms"]["costs"]["mifid_ongoing"] == 1.4946
    assert "mifid_ongoing_from_kid" not in c2["validation"]["warnings"]
    assert c2["regulatory"]["mifid_ex_ante_costs"]["ongoing_pct"] == 1.4946


def test_el_canonico_con_regulatorio_cumple_el_contrato():
    contratos.valida(_convierte(_fondo_con_regulatorio()))


def test_sin_dato_oficial_el_bloque_existe_con_nulos_y_sin_inventos():
    c = _convierte(_fondo_sano())
    reg = c["regulatory"]
    assert reg["sri"] == 4                      # el de Morningstar (KID.SRI), que es lo que hay
    assert reg["kid"] is None and reg["periodic_report"] is None
    assert reg["registers"] is None
    assert c["provenance"]["fields"].get("regulatory.sri") is None   # sin procedencia registrada
