"""Procedencia de cada cartera en export/posiciones.ndjson (14-10-2026).

La plataforma la escribe como `provenance` en holdings (master/holdings.v1.2) y
la usa para no sustituir una cartera completa por una parcial más nueva.
"""
import hashlib
import json
from pathlib import Path

from core import exporta
from core.contratos import valida

ISIN = "LU0000000001"


def _pagina(n_filas: int, declaradas: int | None) -> dict:
    pagina = {"holdingList": [{"securityName": f"P{i}", "weighting": 1.0} for i in range(n_filas)]}
    if declaradas is not None:
        pagina["numberOfAllHolding"] = declaradas
    return pagina


def _respuesta(equity: int, other: int, resumen: int, supresion="0", declaradas_pagina=True) -> dict:
    return {
        "numberOfHolding": 252,  # la raíz no es el total: manda el resumen
        "portfolioSuppression": supresion,
        "holdingSummary": {"numberOfHolding": resumen, "portfolioDate": "2026-09-30T05:00:00.000"},
        "equityHoldingPage": _pagina(equity, equity if declaradas_pagina else None),
        "boldHoldingPage": {},
        "otherHoldingPage": _pagina(other, other if declaradas_pagina else None),
        "portfolioLastestDateFooter": "2026-09-30T05:00:00.000",
    }


def test_cobertura_completa_cuando_cada_pagina_y_el_resumen_cuadran():
    assert exporta.cobertura_sal_position(_respuesta(53, 334, 387)) == ("completa", 387, False)


def test_cobertura_top_n_cuando_morningstar_suprime_el_resto():
    raw = _respuesta(10, 0, 199, supresion="1")
    assert exporta.cobertura_sal_position(raw) == ("top_n", 199, True)


def test_cobertura_parcial_con_mas_de_10_filas_que_no_cuadran():
    assert exporta.cobertura_sal_position(_respuesta(40, 0, 120))[0] == "parcial"


def test_cobertura_desconocida_sin_filas_y_paginas_sin_recuento():
    assert exporta.cobertura_sal_position({"holdingSummary": {}})[0] == "desconocida"
    # sin numberOfAllHolding en una página con filas no se puede decir que esté completa
    assert exporta.cobertura_sal_position(_respuesta(5, 0, 5, declaradas_pagina=False))[0] == "top_n"


def _fondo(base: Path, etiqueta_pos="morningstar_lt:sal_position",
           etiqueta_fecha="morningstar_lt:sal_position", n=12, raw: dict | None = None) -> dict:
    d = {
        "meta": {
            "isin": ISIN,
            "sec_id_morningstar": "F0GBR04PDI",
            "procedencia": {"cartera.posiciones": etiqueta_pos, "cartera.fecha": etiqueta_fecha},
            "adquisicion": {"fuentes": {"morningstar_lt": {"endpoints": {
                "morningstar_lt:sal_position": {"fetched_at": "2026-10-14T05:00:00+00:00"}}}}},
        },
        "identificacion": {"isin": ISIN, "tipo": "fondo", "nombre": "Fondo de prueba"},
        "cartera": {"fecha": "2026-09-30",
                    "posiciones": [{"nombre": f"P{i}", "peso_pct": 100 / n} for i in range(n)]},
        "calidad": {"bucket": "COMPLETO", "flags": []},
    }
    funds = base / "data" / "funds"
    funds.mkdir(parents=True, exist_ok=True)
    (funds / f"{ISIN}.json").write_text(json.dumps(d), encoding="utf-8")
    if raw is not None:
        carpeta = base / "cache" / "raw_morningstar_lt" / ISIN
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / "sal_position.json").write_text(json.dumps(raw), encoding="utf-8")
    return d


def test_procedencia_de_sal_position_con_huella_y_cobertura(tmp_path):
    raw = _respuesta(12, 0, 12)
    d = _fondo(tmp_path, raw=raw)
    proc = exporta.procedencia_cartera(tmp_path, ISIN, d, 12)
    huella = hashlib.sha256((tmp_path / "cache" / "raw_morningstar_lt" / ISIN / "sal_position.json").read_bytes()).hexdigest()
    assert proc == {
        "fuente": "morningstar_lt", "endpoint": "sal_position", "id_fuente": "F0GBR04PDI", "url": None,
        "obtenido": "2026-10-14T05:00:00+00:00", "sha256_respuesta": huella,
        "fecha_de": "detalle_posiciones", "cobertura": "completa", "posiciones_declaradas": 12,
        "supresion_proveedor": False, "run_id": None,
    }


def test_fecha_del_snapshot_y_sin_respuesta_guardada(tmp_path):
    d = _fondo(tmp_path, etiqueta_fecha="morningstar_lt:ETFsnapshot")
    proc = exporta.procedencia_cartera(tmp_path, ISIN, d, 12)
    assert proc["fecha_de"] == "snapshot"
    assert proc["cobertura"] == "desconocida"
    assert proc["sha256_respuesta"] is None


def test_snapshot_y_justetf_son_top_n(tmp_path):
    d = _fondo(tmp_path, etiqueta_pos="morningstar_lt:ETFsnapshot", n=10)
    assert exporta.procedencia_cartera(tmp_path, ISIN, d, 10)["cobertura"] == "top_n"
    d = _fondo(tmp_path, etiqueta_pos="justetf", n=10)
    proc = exporta.procedencia_cartera(tmp_path, ISIN, d, 10)
    assert (proc["fuente"], proc["endpoint"], proc["cobertura"], proc["id_fuente"]) == ("justetf", None, "top_n", None)


def test_una_cartera_retenida_se_describe_igual_que_la_servida_de_la_copia(tmp_path):
    # Revisión de la rama, IMP-A: con `retenido:justetf@...` salía
    # fuente "retenido", cobertura desconocida y sin fecha de obtención.
    copia = tmp_path / "cache" / "justetf_overview" / f"{ISIN}.json"
    copia.parent.mkdir(parents=True)
    copia.write_text(json.dumps({"isin": ISIN, "fetched_at": 1791954000.0, "ficha": {}}), encoding="utf-8")
    de_la_copia = exporta.procedencia_cartera(tmp_path, ISIN, _fondo(tmp_path, etiqueta_pos="justetf", n=10), 10)
    retenida = _fondo(tmp_path, etiqueta_pos="retenido:justetf@2026-10-14",
                      etiqueta_fecha="retenido:morningstar_lt:sal_position@2026-10-14", n=10)
    proc = exporta.procedencia_cartera(tmp_path, ISIN, retenida, 10)
    assert proc == de_la_copia
    assert (proc["fuente"], proc["endpoint"], proc["cobertura"], proc["obtenido"]) == (
        "justetf", None, "top_n", "2026-10-14T05:00:00+00:00")
    assert proc["fecha_de"] == "detalle_posiciones"     # la etiqueta de la fecha también se desenvuelve

    # sin copia, la fecha de obtención es la de la retención
    copia.unlink()
    proc = exporta.procedencia_cartera(tmp_path, ISIN, retenida, 10)
    # el mismo formato que con copia (O-1): la etiqueta solo da el día
    assert (proc["fuente"], proc["cobertura"], proc["obtenido"]) == ("justetf", "top_n", "2026-10-14T00:00:00+00:00")
    assert exporta.procedencia_cartera(tmp_path, ISIN, _fondo(tmp_path, etiqueta_pos="justetf", n=10), 10)[
        "obtenido"] is None


def test_sin_procedencia_de_posiciones_no_se_inventa(tmp_path):
    d = _fondo(tmp_path)
    d["meta"]["procedencia"] = {}
    assert exporta.procedencia_cartera(tmp_path, ISIN, d, 12) is None


def test_export_escribe_la_procedencia_en_cada_parte_y_cumple_el_contrato(tmp_path):
    _fondo(tmp_path, n=2500, raw=_respuesta(2500, 0, 2500))
    exporta.export_all(tmp_path, tmp_path / "export")
    lineas = [json.loads(x) for x in (tmp_path / "export" / "posiciones.ndjson").read_text(encoding="utf-8").splitlines()]
    assert [x["parte"] for x in lineas] == [1, 2]
    assert lineas[0]["procedencia"] == lineas[1]["procedencia"]
    assert lineas[0]["procedencia"]["cobertura"] == "completa"
    for linea in lineas:
        valida(linea, "fondosdb-holdings.v1.schema.json")
