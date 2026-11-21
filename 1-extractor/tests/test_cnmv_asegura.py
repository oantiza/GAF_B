# -*- coding: utf-8 -*-
"""Un ISIN español dado de alta después de procesar un periodo CNMV recibe
ese periodo sin pasos manuales.

Caso real del 13-10-2026: el último mensual y el último trimestral ya estaban
en cache/cnmv/parsed para el resto del universo, `asegura_periodos` los daba
por hechos y los 9 fondos Fineco nuevos se quedaron sin datos CNMV. Los ZIP
son mínimos (dos fondos) y se construyen aquí; no hay red.
"""
import datetime as dt
import json
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import cnmv  # noqa: E402

PREVIO = "ES0100000002"   # ya estaba en el universo cuando se procesaron los periodos
NUEVO = "ES0200000004"    # alta posterior
AUSENTE = "ES0300000006"  # no figura en los ZIP
ANO = dt.date.today().year
MENSUAL = f"{ANO}-05"
TRIMESTRAL = f"{ANO - 1}-12"


def _entidad(registro: str, isin: str, clase_extra: str = "") -> str:
    return (f"<Entidad><Tipo>FI</Tipo><NumeroRegistro>{registro}</NumeroRegistro>"
            f"<Compartimento><NumeroCompartimento>0</NumeroCompartimento>"
            f"<Clase><NumeroClase>0</NumeroClase><ISIN>{isin}</ISIN>{clase_extra}</Clase>"
            f"</Compartimento></Entidad>")


def _cartera(registro: str, isin_valor: str) -> str:
    return (f"<Entidad><Tipo>FI</Tipo><NumeroRegistro>{registro}</NumeroRegistro>"
            f"<Compartimento><NumeroCompartimento>0</NumeroCompartimento><InversionesFinancieras>"
            f"<ClaseIF>INTERIOR</ClaseIF><DescripcionIF>Renta Variable Cotizada</DescripcionIF>"
            f"<CodigoISIN>{isin_valor}</CodigoISIN><DescripcionValor>ACCIONES|X</DescripcionValor>"
            f"<Divisa>EUR</Divisa><ValorMercado>1000.00</ValorMercado>"
            f"</InversionesFinancieras></Compartimento></Entidad>")


def _xml(*entidades: str) -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Raiz>' + "".join(entidades) + "</Raiz>"


def _zip(ruta: Path, ficheros: dict[str, str]) -> None:
    with zipfile.ZipFile(ruta, "w") as z:
        for nombre, contenido in ficheros.items():
            z.writestr(nombre, contenido)


class _HttpFalso:
    """Sirve las páginas de descargas; descargar un ZIP es un fallo del test."""

    sin_red = False

    def __init__(self):
        self.descargas = []

    def get(self, url, **_kw):
        if url == cnmv.PAGINA_ACTUAL:
            meses = ("Mayo", "Marzo")
        elif url == cnmv.PAGINA_EJERCICIO.format(ano=ANO - 1):
            meses = ("Diciembre",)
        else:
            meses = ()
        html = "".join(f'<a href="https://www.cnmv.es/webservices/verdocumento/ver?e={m}" '
                       f'title="{m}">{m}</a>' for m in meses)
        return SimpleNamespace(text=html)

    def download(self, url, destino, **_kw):
        self.descargas.append(url)
        raise AssertionError(f"no debía descargar {url}: el ZIP ya está en cache/cnmv")


@pytest.fixture
def base(tmp_path, monkeypatch):
    """cache/cnmv con el mensual y el trimestral ya procesados para PREVIO."""
    monkeypatch.setattr(cnmv, "_ASEGURADOS", set())
    cache = tmp_path / "cache" / "cnmv"
    (cache / "parsed").mkdir(parents=True)
    a, m = MENSUAL.replace("-", ""), TRIMESTRAL.replace("-", "")
    _zip(cache / f"{MENSUAL}.zip", {
        f"FONDREGISTRO_{a}.xml": _xml(_entidad("100", PREVIO), _entidad("200", NUEVO)),
        f"FONDMENS_{a}.xml": _xml(_entidad("100", PREVIO, "<Patrimonio>1000.00</Patrimonio>"),
                                  _entidad("200", NUEVO, "<Patrimonio>2000.00</Patrimonio>")),
    })
    trim = ("<ComisionGestion>0.50</ComisionGestion><RatioTotalGastos>"
            "<RatioTotalGastos_TrimestreActual>0.40</RatioTotalGastos_TrimestreActual></RatioTotalGastos>")
    _zip(cache / f"{TRIMESTRAL}.zip", {
        f"FONDREGISTRO_{m}.xml": _xml(_entidad("100", PREVIO), _entidad("200", NUEVO)),
        f"FONDTRIM_{m}.xml": _xml(_entidad("100", PREVIO, trim), _entidad("200", NUEVO, trim)),
        f"FONDCART_{m}.xml": _xml(_cartera("100", "ES0148396007"), _cartera("200", "FR0000121014")),
    })
    for periodo in (MENSUAL, TRIMESTRAL):
        cnmv.procesa_zip(tmp_path, cache / f"{periodo}.zip", periodo, {PREVIO})
    # marzo ya se miró y salió sin ficheros trimestrales, como en el real de 2026
    (cache / f"{ANO}-03_inventario.json").write_text(
        json.dumps([f"FONDREGISTRO_{ANO}03.xml", f"FONDMENS_{ANO}03.xml"]), encoding="utf-8")
    return tmp_path


def _parsed(base: Path, isin: str) -> dict:
    return json.loads((base / "cache" / "cnmv" / "parsed" / f"{isin}.json").read_text(encoding="utf-8"))


def test_el_isin_nuevo_recibe_los_periodos_ya_procesados_para_otros(base):
    ruta_previo = base / "cache" / "cnmv" / "parsed" / f"{PREVIO}.json"
    antes = ruta_previo.read_bytes(), ruta_previo.stat().st_mtime_ns
    assert not (base / "cache" / "cnmv" / "parsed" / f"{NUEVO}.json").exists()
    http = _HttpFalso()

    hecho = cnmv.asegura_periodos(http, base, {PREVIO, NUEVO})

    assert hecho == {"mensual": MENSUAL, "trimestral": TRIMESTRAL}
    assert http.descargas == []
    nuevo = _parsed(base, NUEVO)
    assert set(nuevo) == {MENSUAL, TRIMESTRAL}
    ficheros = {f.split("_")[0] for f in nuevo[TRIMESTRAL]}
    assert {"FONDTRIM", "FONDCART"} <= ficheros
    cartera = nuevo[TRIMESTRAL][f"FONDCART_{TRIMESTRAL.replace('-', '')}.xml"][0]
    assert cartera["Entidad"]["NumeroRegistro"] == "200"  # su cartera, no la de PREVIO
    # los parsed de los demás no se reescriben
    assert (ruta_previo.read_bytes(), ruta_previo.stat().st_mtime_ns) == antes
    # y la fuente cnmv ya trae el trimestral del nuevo
    out = cnmv.fetch(NUEVO, http, {}, base=base)
    assert out["meta"]["cnmv_periodo"] == MENSUAL
    assert out["meta"]["cnmv_periodo_trimestral"] == TRIMESTRAL


def test_con_todo_procesado_no_relee_ningun_zip(base, monkeypatch):
    llamadas = []
    monkeypatch.setattr(cnmv, "procesa_zip", lambda *a, **k: llamadas.append(a))
    http = _HttpFalso()
    assert cnmv.asegura_periodos(http, base, {PREVIO}) == {}
    assert llamadas == [] and http.descargas == []


def test_un_isin_que_no_esta_en_el_zip_se_busca_una_sola_vez(base, monkeypatch):
    http = _HttpFalso()
    cnmv.asegura_periodos(http, base, {PREVIO, AUSENTE})
    assert not (base / "cache" / "cnmv" / "parsed" / f"{AUSENTE}.json").exists()
    assert AUSENTE in json.loads((base / "cache" / "cnmv" / f"{MENSUAL}_ausentes.json")
                                 .read_text(encoding="utf-8"))

    # otra pasada (otro proceso): no vuelve a recorrer el ZIP por él
    monkeypatch.setattr(cnmv, "_ASEGURADOS", set())
    llamadas = []
    monkeypatch.setattr(cnmv, "procesa_zip", lambda *a, **k: llamadas.append(a))
    assert cnmv.asegura_periodos(http, base, {PREVIO, AUSENTE}) == {}
    assert llamadas == [] and http.descargas == []
