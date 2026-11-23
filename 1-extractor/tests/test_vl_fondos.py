# -*- coding: utf-8 -*-
"""VL de los fondos desde EODHD y métricas propias (fase 0), con HTTP de mentira.

Lo que se prueba: qué se escribe según la divisa y la política de la clase,
que el token no viaja en la URL guardada, y que el contraste deja a
Morningstar fuera de la ficha pero en `meta.contraste`.
"""
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import nucleo, procedencia, registro  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint  # noqa: E402
from core.schema import set_path  # noqa: E402
from fetchers import vl_fondos  # noqa: E402


class _Resp:
    def __init__(self, cuerpo, ok=True, fetched_at=None):
        self.ok, self.status = ok, 200 if ok else 404
        self.fetched_at = fetched_at or datetime(2026, 10, 28, 7, 0).timestamp()
        self._cuerpo = cuerpo
        self.text = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)

    def json(self):
        return json.loads(self.text)


class _Http:
    """Responde por URL; anota cada petición (url, params, familia)."""

    def __init__(self, serie, divisa="EUR", estr=2.0):
        self.serie, self.divisa, self.estr = serie, divisa, estr
        self.peticiones = []

    def get(self, url, params=None, force=False, familia=None, ttl_dias=None):
        self.peticiones.append((url, dict(params or {}), familia))
        if "/eod/" in url:
            return _Resp([{"date": f.isoformat(), "close": p, "adjusted_close": p}
                          for f, p in self.serie]) if self.serie else _Resp([], ok=False)
        if "/search/" in url:
            isin = url.rsplit("/", 1)[1]
            return _Resp([{"Code": isin, "Exchange": "EUFUND", "Currency": self.divisa}])
        if "/EST/" in url:
            filas = ["TIME_PERIOD,OBS_VALUE"] + [
                f"{date(2019, 10, 1) + timedelta(days=i)},{self.estr}" for i in range(2700)]
            return _Resp("\n".join(filas))
        raise AssertionError(url)


def _serie(hasta=date(2026, 10, 27), anos=6, crec=0.05):
    out, d = [], hasta - timedelta(days=365 * anos)
    p0 = d
    while d <= hasta:
        if d.weekday() < 5:
            out.append((d, round(100 * (1 + crec) ** ((d - p0).days / 365), 4)))
        d += timedelta(days=1)
    return out


@pytest.fixture(autouse=True)
def _token(monkeypatch):
    monkeypatch.setenv("EODHD_API_TOKEN", "tok-secreto")


def _fetch(isin, http, previo=None, tmp_path=None):
    with procedencia.activa("vl_eodhd") as reg:
        out = vl_fondos.fetch(isin, http, {}, base=tmp_path, tipo="fondo", previo=previo)
    return out, reg


def test_clase_eur_de_acumulacion_trae_vl_y_metricas(tmp_path):
    http = _Http(_serie())
    out, reg = _fetch("LU0000000001", http, {"cssf": {"identificacion": {"nombre": "Fondo A EUR Acc"}}},
                      tmp_path)
    assert out["valoracion"]["vl_fecha"] == "2026-10-27"
    assert out["valoracion"]["vl_divisa"] == "EUR"
    assert out["rentabilidad"]["fecha_dato"] == "2026-09-30"          # cierre de mes
    assert out["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == pytest.approx(5.0, abs=0.1)
    assert out["riesgo"]["fecha_dato"] == "2026-09-30"
    assert out["riesgo"]["sharpe"]["3a"]["fondo"] is not None
    hp = out["riesgo"]["historial_precios"]
    assert hp["politica"] == "nombre_acumulacion" and hp["divisa_metricas"] == "EUR"
    assert hp["rf_referencia"] == "ESTR_EUR" and "aviso_metricas" not in hp
    # el token va en los parámetros, nunca en la URL (la caché guarda la URL)
    assert all("tok-secreto" not in url for url, _p, _f in http.peticiones)
    assert reg.resuelve("rentabilidad.fecha_dato") == "vl_eodhd:eod"
    assert reg.resuelve("riesgo.sharpe.3a.fondo") == "vl_eodhd:estr"


def test_clase_de_reparto_solo_trae_vl(tmp_path):
    out, _ = _fetch("LU0000000002", _Http(_serie()),
                    {"cssf": {"identificacion": {"nombre": "Fondo B USD Dis"}}}, tmp_path)
    assert out["valoracion"]["vl"] and "rentabilidad" not in out
    assert "volatilidad_pct" not in out.get("riesgo", {})
    assert out["riesgo"]["historial_precios"]["aviso_metricas"] == "sin_metricas_nombre_reparto"


def test_politica_desconocida_solo_trae_vl(tmp_path):
    out, _ = _fetch("LU0000000003", _Http(_serie()), {}, tmp_path)
    assert "rentabilidad" not in out
    assert out["riesgo"]["historial_precios"]["aviso_metricas"] == "sin_metricas_politica_desconocida"


def test_clase_en_usd_se_calcula_en_euros_y_con_sharpe(tmp_path, monkeypatch):
    # Metodo V2 (decision 10). Con un cambio constante, rentabilidad y volatilidad no se
    # mueven: asi la prueba mide la conversion sin mezclarla con el riesgo de divisa.
    from fetchers import cambios_bce
    monkeypatch.setattr(cambios_bce, "cambios", lambda moneda, http: [(date(1999, 1, 4), 2.0)] + [
        (date(2020, 1, 1) + timedelta(days=3 * i), 2.0) for i in range(900)
    ])
    s = _serie()
    http = _Http(s, divisa="USD")
    out, reg = _fetch("LU0000000004", http,
                      {"amf_geco": {"identificacion": {"politica_distribucion": "acumulacion"}}},
                      tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert out["valoracion"]["vl_divisa"] == "USD" and out["valoracion"]["vl"] == s[-1][1]
    assert hp["divisa_metricas"] == "EUR" and hp["politica"] == "politica_acumulacion"
    assert hp["divisa_origen"] == "USD" and hp["fx_source"] == "ECB_REFERENCE"
    assert out["rentabilidad"]["trailing_pct"]["5a_anualizada"]["fondo"] == pytest.approx(5.0, abs=0.1)
    assert out["riesgo"]["volatilidad_pct"]["3a"]["fondo"] is not None
    assert out["riesgo"]["sharpe"]["3a"]["fondo"] is not None and hp["rf_referencia"] == "ESTR_EUR"
    assert "aviso_sharpe" not in hp
    assert reg.resuelve("rentabilidad.fecha_dato") == "vl_eodhd:eod"


def test_clase_sin_cambio_no_trae_metricas_en_otra_divisa(tmp_path, monkeypatch):
    from fetchers import cambios_bce
    monkeypatch.setattr(cambios_bce, "cambios", lambda moneda, http: [])
    out, _reg = _fetch("LU0000000004", _Http(_serie(), divisa="USD"),
                       {"amf_geco": {"identificacion": {"politica_distribucion": "acumulacion"}}},
                       tmp_path)
    assert out["riesgo"]["historial_precios"]["aviso_metricas"] == "sin_metricas_sin_cambio"
    assert "volatilidad_pct" not in out["riesgo"]


def test_serie_parada_no_trae_vl_ni_metricas(tmp_path):
    # EODHD dejó de actualizarla en enero: el VL de Morningstar será más reciente.
    out, _ = _fetch("LU0000000010", _Http(_serie(hasta=date(2026, 1, 15))),
                    {"cssf": {"identificacion": {"nombre": "Fondo Y EUR Acc"}}}, tmp_path)
    assert "valoracion" not in out and "rentabilidad" not in out
    hp = out["riesgo"]["historial_precios"]
    assert hp["last_date"] == "2026-01-15" and hp["aviso_vl"] == "serie_parada(286d)"


def test_una_ruptura_de_la_serie_recorta_las_metricas(tmp_path):
    # Cambio de unidad hace 2 años: sin 3 ni 5 años, con 1 año y aviso.
    s = [(f, p * (30 if f < date(2024, 10, 1) else 1)) for f, p in _serie()]
    out, _ = _fetch("LU0000000011", _Http(s),
                    {"cssf": {"identificacion": {"nombre": "Fondo W EUR Acc"}}}, tmp_path)
    t = out["rentabilidad"]["trailing_pct"]
    assert "1a" in t and "3a_anualizada" not in t and "5a_anualizada" not in t
    assert out["riesgo"]["historial_precios"]["aviso_serie"] == "ruptura_serie(2024-10-01)"
    assert out["valoracion"]["vl"] == s[-1][1]                 # el VL no se toca


def test_un_dato_suelto_que_salta_y_vuelve_no_recorta_nada_y_se_dice(tmp_path):
    """Decisión A-166. El mismo fondo con un solo dato multiplicado por 30 hace dos años: con la regla de antes
    cortaba ahí la serie y se quedaba sin 3 ni 5 años; ahora el dato se quita, las ventanas salen las de la serie
    limpia y la ficha dice qué dato fue y entre cuáles estaba."""
    limpia = _serie()
    dia = next(i for i, (f, _p) in enumerate(limpia) if f >= date(2024, 10, 1))
    con_pico = [(f, p * 30 if i == dia else p) for i, (f, p) in enumerate(limpia)]
    previo = {"cssf": {"identificacion": {"nombre": "Fondo W EUR Acc"}}}
    out, _ = _fetch("LU0000000012", _Http(con_pico), previo, tmp_path)
    sin_el, _ = _fetch("LU0000000012", _Http(limpia[:dia] + limpia[dia + 1:]), previo, tmp_path)

    hp = out["riesgo"]["historial_precios"]
    assert "aviso_serie" not in hp
    assert hp["picos_descartados"] == [{"fecha": limpia[dia][0].isoformat(), "valor": con_pico[dia][1],
                                        "anterior": limpia[dia - 1][1], "siguiente": limpia[dia + 1][1]}]
    assert {"1a", "3a_anualizada", "5a_anualizada"} <= set(out["rentabilidad"]["trailing_pct"])
    # Las cifras son las de la serie sin ese dato: ni una más, ni una distinta.
    assert out["rentabilidad"] == sin_el["rentabilidad"]
    assert out["riesgo"]["volatilidad_pct"] == sin_el["riesgo"]["volatilidad_pct"]
    assert out["riesgo"]["sharpe"] == sin_el["riesgo"]["sharpe"]
    assert out["riesgo"]["max_drawdown_pct"] == sin_el["riesgo"]["max_drawdown_pct"]
    assert "picos_descartados" not in sin_el["riesgo"]["historial_precios"]


def test_la_ficha_dice_con_que_version_del_metodo_se_calculo(tmp_path):
    # A-158: la plataforma sella `EXTRACTOR_MONTHLY_V3` solo si la ficha dice que es la versión 3; desde el 17-11-2026, la 4.
    out, _ = _fetch("LU0000000013", _Http(_serie()), {"cssf": {"identificacion": {"nombre": "Fondo A EUR Acc"}}},
                    tmp_path)
    assert out["riesgo"]["historial_precios"]["metodo"] ==         "core.metricas v4: cierre de mes, en euros, riesgo con rentabilidades mensuales"


def test_un_puente_no_es_una_serie_parada():
    s = [(date(2026, 10, 20), 1.0)]
    assert vl_fondos.dias_parada(s, datetime(2026, 10, 30, 7).timestamp()) is None
    assert vl_fondos.dias_parada(s, datetime(2026, 11, 2, 7).timestamp()) == 13


def test_sin_serie_no_trae_nada(tmp_path):
    assert _fetch("LU0000000006", _Http([]), {}, tmp_path)[0] == {}


@pytest.mark.parametrize("nombre, isin, esperado", [
    ("Robeco BP Global Premium Equities D EUR", "LU0203975437", None),   # «D» suelta: no se usa
    ("DWS Top Dividende LD", "DE0009848119", False),
    ("DWS Concept Kaldemorgen LC", "LU0599946893", True),
    ("Amundi Funds Global Equity A EUR (C)", "LU0000000007", None),
    ("Bestinver Internacional FI", "ES0114638036", True),                 # ES: acumula por norma
    ("Santander Rendimiento Clase Reparto FI", "ES0000000008", False),
    ("Fidelity World A-Dist-EUR", "LU0069449576", False),
    ("Fidelity World A-Acc-EUR", "LU1261432659", True),
])
def test_politica_por_nombre(nombre, isin, esperado):
    acumula, _motivo = vl_fondos.politica(isin, {"x": {"identificacion": {"nombre": nombre}}})
    assert acumula is esperado


def test_la_politica_de_una_fuente_gana_al_nombre():
    previo = {"amf_geco": {"identificacion": {"politica_distribucion": "distribucion",
                                               "nombre": "Fonds X Acc"}}}
    assert vl_fondos.politica("FR0000000001", previo) == (False, "politica_distribucion")


def test_politica_desde_fondos_csv(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "fondos.csv").write_text(
        "isin,nombre,tipo\nLU0000000009,Fondo Z EUR Acc,fondo\n", encoding="utf-8")
    assert vl_fondos.politica("LU0000000009", {}, tmp_path) == (True, "nombre_acumulacion")


# ------------------------------------------------------------- contraste
def _ms(datos):
    def fetch(isin, ctx):
        out = {}
        with procedencia.etapa("screener"):
            for ruta, valor in datos.items():
                set_path(out, ruta, valor)
        return out
    return Adaptador(id="morningstar_lt", descripcion="", oficial=False,
                     capacidades={r: "rendimiento" for r in datos},
                     endpoints=(Endpoint("screener", "rendimiento"),), fetch=fetch, orden=20)


def _vl(datos):
    def fetch(isin, ctx):
        out = {}
        with procedencia.etapa("eod"):
            for ruta, valor in datos.items():
                set_path(out, ruta, valor)
        return out
    return Adaptador(id="vl_eodhd", descripcion="", oficial=False,
                     capacidades={r: "precio" for r in datos},
                     endpoints=(Endpoint("eod", "precio"),), fetch=fetch, orden=16)


MS = {"valoracion.vl": 10.0, "valoracion.vl_fecha": "2026-07-31",
      "rentabilidad.fecha_dato": "2026-09-30",
      "rentabilidad.trailing_pct.1a.fondo": 5.1, "rentabilidad.trailing_pct.1a.categoria": 4.0,
      "rentabilidad.trailing_pct.10a_anualizada.fondo": 7.0,
      "riesgo.volatilidad_pct.3a.fondo": 11.0, "rating.estrellas": 4}


def test_el_contraste_deja_a_morningstar_fuera_de_la_ficha(tmp_path):
    vl = _vl({"valoracion.vl": 10.5, "valoracion.vl_fecha": "2026-10-27",
              "rentabilidad.fecha_dato": "2026-09-30", "rentabilidad.trailing_pct.1a.fondo": 5.0})
    res = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                          [vl, _ms(MS)])
    d = res.datos
    assert d["valoracion"]["vl"] == 10.5 and d["valoracion"]["vl_fecha"] == "2026-10-27"
    assert d["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == 5.0
    # el bloque entero: el 10 años de Morningstar no se mezcla con lo propio
    assert "10a_anualizada" not in d["rentabilidad"]["trailing_pct"]
    assert "volatilidad_pct" not in d.get("riesgo", {})
    # lo que no es de la serie sigue siendo de Morningstar
    assert d["rentabilidad"]["trailing_pct"]["1a"]["categoria"] == 4.0
    assert d["rating"]["estrellas"] == 4
    con = d["meta"]["contraste"]
    assert con["valoracion.vl"] == {"fuente": "morningstar_lt:screener", "valor": 10.0,
                                    "desplazada_por": "vl_eodhd", "bloque": "vl"}
    assert con["rentabilidad.trailing_pct.10a_anualizada.fondo"]["bloque"] == "metricas"
    assert d["meta"]["procedencia"]["valoracion.vl"] == "vl_eodhd:eod"


def test_sin_metricas_propias_morningstar_sigue_de_respaldo(tmp_path):
    vl = _vl({"valoracion.vl": 10.5, "valoracion.vl_fecha": "2026-10-27"})   # clase de reparto
    d = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                        [vl, _ms(MS)]).datos
    assert d["valoracion"]["vl"] == 10.5
    assert d["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == 5.1
    assert d["meta"]["procedencia"]["rentabilidad.trailing_pct.1a.fondo"] == "morningstar_lt:screener"
    assert set(d["meta"]["contraste"]) == {"valoracion.vl", "valoracion.vl_fecha"}


def test_sin_sharpe_propio_queda_el_de_morningstar(tmp_path):
    # Clase en USD de acumulación: métricas propias, Sharpe de Morningstar.
    vl = _vl({"valoracion.vl": 10.5, "valoracion.vl_fecha": "2026-10-27",
              "rentabilidad.fecha_dato": "2026-09-30", "rentabilidad.trailing_pct.1a.fondo": 5.0,
              "riesgo.volatilidad_pct.3a.fondo": 12.0})
    d = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                        [vl, _ms({**MS, "riesgo.sharpe.3a.fondo": 0.7})]).datos
    assert d["riesgo"]["volatilidad_pct"]["3a"]["fondo"] == 12.0
    assert d["riesgo"]["sharpe"]["3a"]["fondo"] == 0.7
    assert d["meta"]["procedencia"]["riesgo.sharpe.3a.fondo"] == "morningstar_lt:screener"
    assert "riesgo.sharpe.3a.fondo" not in d["meta"]["contraste"]


def test_sin_vl_de_eodhd_no_hay_contraste(tmp_path):
    d = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                        [_ms(MS)]).datos
    assert d["valoracion"]["vl"] == 10.0 and "contraste" not in d["meta"]


def test_las_reglas_de_contraste_desplazan_rutas_declaradas():
    from core.adquisicion import capacidades
    vl = registro.por_id()["vl_eodhd"]
    for regla in registro.CONTRASTE:
        assert regla["manda"] == "vl_eodhd"
        assert capacidades.cubre(vl.capacidades, regla["si_trae"])
        for ruta in regla["rutas"]:
            # La fecha por ventana de Morningstar (decisión B-74) sale con su cifra
            # desplazada aunque la serie propia no la escriba todavía.
            if ruta == "rentabilidad.fecha_dato_por_ventana.*":
                continue
            # `riesgo.max_drawdown.*` desplaza el bloque entero (también los
            # meses de caída de Morningstar, que la serie propia no da).
            ejemplo = ruta.replace("max_drawdown.*", "max_drawdown.pct").replace("*", "x")
            assert capacidades.cubre(vl.capacidades, ejemplo), ruta



def _kid(tmp_path, isin, politica, huella="h1"):
    (tmp_path / "config").mkdir(exist_ok=True)
    (tmp_path / "config" / "politica_kid.json").write_text(json.dumps({"clases": {
        isin: {"politica": politica, "kid_sha256": huella, "cita": "lo que dice el documento"}}}),
        encoding="utf-8")


def _con_kid(nombre, huella="h1"):
    return {"cssf": {"identificacion": {"nombre": nombre},
                     "documentos_oficiales": {"kid_sha256": huella}}}


def test_el_kid_gana_al_nombre_y_viaja_con_la_cifra(tmp_path):
    _kid(tmp_path, "LU0000000020", "acumulacion")
    out, _ = _fetch("LU0000000020", _Http(_serie()), _con_kid("Asia Pacific Income Fund"), tmp_path)
    assert out["riesgo"]["historial_precios"]["politica"] == "kid_acumulacion"
    assert "volatilidad_pct" in out["riesgo"]
    assert out["documentos_oficiales"]["kid_politica"] == "acumulacion"
    assert out["documentos_oficiales"]["kid_politica_cita"] == "lo que dice el documento"


def test_el_kid_gana_al_historial_de_pagos_del_proveedor(tmp_path):
    """Decisión 78: el proveedor le lista pagos, su KID dice que acumula, y manda el KID."""
    _kid(tmp_path, "LU0000000022", "acumulacion")
    previo = _con_kid("Fondo X")
    previo["cssf"]["distribuciones"] = {"historial": [{"fecha": "2026-10-01", "importe_por_participacion": 0.06}]}
    out, _ = _fetch("LU0000000022", _Http(_serie()), previo, tmp_path)
    assert out["riesgo"]["historial_precios"]["politica"] == "kid_acumulacion"
    assert "volatilidad_pct" in out["riesgo"]
    # Y si el documento ya no es el leído, la evidencia se apaga y vuelve a mandar el historial.
    out, _ = _fetch("LU0000000022", _Http(_serie()), {"cssf": {**previo["cssf"], "documentos_oficiales": {"kid_sha256": "otra"}}}, tmp_path)
    assert out["riesgo"]["historial_precios"]["politica"] == "historial_repartos"
    assert "volatilidad_pct" not in out["riesgo"]


def test_lo_que_dice_el_kid_viaja_aunque_la_serie_este_parada(tmp_path):
    """Una serie parada no da métricas ni VL, y la clase sigue acumulando: Polar Global Insurance, decisión 78."""
    _kid(tmp_path, "LU0000000023", "acumulacion")
    out, _ = _fetch("LU0000000023", _Http(_serie(hasta=date(2026, 5, 22))), _con_kid("Fondo X"), tmp_path)
    assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")
    assert "volatilidad_pct" not in out["riesgo"]
    assert "valoracion" not in out
    assert out["documentos_oficiales"]["kid_politica"] == "acumulacion"
    assert out["documentos_oficiales"]["kid_politica_cita"] == "lo que dice el documento"


def test_el_kid_que_dice_reparto_no_deja_calcular(tmp_path):
    _kid(tmp_path, "LU0000000021", "distribucion")
    out, _ = _fetch("LU0000000021", _Http(_serie()), _con_kid("Fondo X Acc"), tmp_path)
    assert "volatilidad_pct" not in out.get("riesgo", {})
    assert out["riesgo"]["historial_precios"]["aviso_metricas"] == "sin_metricas_kid_distribucion"
    assert out["documentos_oficiales"]["kid_politica"] == "distribucion"


def test_si_el_kid_cambia_la_evidencia_se_apaga(tmp_path):
    _kid(tmp_path, "LU0000000022", "acumulacion", huella="vieja")
    out, _ = _fetch("LU0000000022", _Http(_serie()), _con_kid("Asia Income Fund", "nueva"), tmp_path)
    assert out["riesgo"]["historial_precios"]["aviso_metricas"] == "sin_metricas_nombre_reparto"
    assert "documentos_oficiales" not in out


def test_la_respuesta_guardada_sin_repartos_viaja_con_la_cifra(tmp_path):
    carpeta = tmp_path / "cache" / "raw_morningstar_lt" / "LU0000000023"
    carpeta.mkdir(parents=True)
    (carpeta / "sal_distribution.json").write_text('{"distribution": []}', encoding="utf-8")
    out, _ = _fetch("LU0000000023", _Http(_serie()), {}, tmp_path)
    assert out["riesgo"]["historial_precios"]["politica"] == "sin_repartos_del_proveedor"
    assert out["distribuciones"]["historial_consultado"] is True


def _fetch_etf(isin, http, previo, monkeypatch, moneda="EUR"):
    import fetchers.eodhd as eodhd
    monkeypatch.setattr(eodhd, "_resuelve_simbolo", lambda *a, **k: {
        "Code": "EUNL", "Exchange": "XETRA", "Currency": moneda})
    with procedencia.activa("vl_eodhd"):
        return vl_fondos.fetch(isin, http, {}, tipo="etf", previo=previo)


def test_etf_con_el_calculo_de_los_fondos_sobre_su_precio_de_mercado(monkeypatch):
    http = _Http(_serie(hasta=date(2026, 10, 30)))
    out = _fetch_etf("IE00B4L5Y983", http, {}, monkeypatch)
    hp = out["riesgo"]["historial_precios"]
    assert hp["clase_de_serie"] == "PRECIO_DE_MERCADO"
    assert hp["source_listing_id"] == "EODHD:EUNL.XETRA" and hp["source_history"] == "eodhd"
    assert hp["divisa_metricas"] == "EUR" and "divisa_origen" not in hp
    assert out["rentabilidad"]["fecha_dato"] == "2026-10-31"
    assert out["riesgo"]["volatilidad_pct"]["3a"]["fondo"] is not None
    assert out["riesgo"]["sharpe"]["3a"]["fondo"] is not None
    # El precio de mercado no desplaza el VL que venga de otra fuente.
    assert "valoracion" not in out
    assert any("/eod/EUNL.XETRA" in p[0] for p in http.peticiones)


def test_etf_que_reparte_se_calcula_porque_el_ajustado_lleva_el_dividendo(monkeypatch):
    previo = {"ms": {"identificacion": {"nombre": "iShares World (Dist)"},
                     "distribuciones": {"historial": [{"fecha": "2026-03-01"}]}}}
    out = _fetch_etf("IE00B0M62Q58", _Http(_serie()), previo, monkeypatch)
    assert out["riesgo"]["volatilidad_pct"]["3a"]["fondo"] is not None
    assert "aviso_metricas" not in out["riesgo"]["historial_precios"]


def test_la_divisa_es_la_de_la_cotizacion_y_no_la_de_la_ficha(monkeypatch):
    """Tres fichas dicen USD en clases que en XETRA cotizan en euros: convertir daria un disparate."""
    pedidas = []
    monkeypatch.setattr(vl_fondos.cambios_bce, "serie_en_euros",
                        lambda s, moneda, http: pedidas.append(moneda) or s)
    previo = {"ms": {"valoracion": {"vl_divisa": "USD"}, "identificacion": {"divisa_base": "USD"}}}
    _fetch_etf("IE00B5BMR087", _Http(_serie()), previo, monkeypatch)
    assert pedidas == ["EUR"]
    _fetch_etf("US78462F1030", _Http(_serie()), {}, monkeypatch, moneda="USD")
    assert pedidas == ["EUR", "USD"]


def test_el_etc_no_entra(monkeypatch):
    previo = {"_anterior": {"identificacion": {"tipo_producto": "etc"}}}
    assert _fetch_etf("IE00B4ND3602", _Http(_serie()), previo, monkeypatch) == {}


class _HttpStor(_Http):
    """La forma de iShares Energy Storage el 05-11-2026: por ISIN, vacío; por código, `STOR.AS` en dólares y sin ISIN."""

    def get(self, url, params=None, force=False, familia=None, ttl_dias=None):
        if "/search/" in url:
            self.peticiones.append((url, dict(params or {}), familia))
            return _Resp([{"Code": "STOR", "Exchange": "AS", "Type": "ETF", "Currency": "USD", "ISIN": None}]
                         if url.endswith("/search/STOR") else [])
        return super().get(url, params, force, familia)


def _serie_plana(desde=date(2025, 2, 10), hasta=date(2026, 11, 4), precio=100.0):
    dias = (desde + timedelta(days=i) for i in range((hasta - desde).days + 1))
    return [(d, precio) for d in dias if d.weekday() < 5]


def _correccion_de_simbolo(base, isin, simbolo):
    (base / "config").mkdir()
    cuerpo = {isin: {"identificacion.simbolo_eodhd": {"valor": simbolo, "motivo": "prueba", "autor": "prueba",
                                                      "fecha": "2026-11-05T00:00:00Z"}}}
    (base / "config" / "correcciones.json").write_text(
        json.dumps({"version": 1, "correcciones": cuerpo}), encoding="utf-8")


def test_un_etf_con_correccion_se_mide_en_euros_sobre_esa_cotizacion(tmp_path, monkeypatch):
    """Resultado conocido, a mano: 100 dólares sin moverse y el euro pasa de 1,00 a 1,25 dólares el 01-11-2025.

    A 31-10-2026 en euros va de 100 a 80: -20 %. De los doce meses uno cae un 20 % y once no se mueven, así que
    la desviación muestral mensual es 0,2/raíz(12) y la volatilidad anualizada, 20 %. A 3 años la serie no llega,
    y esa ventana no sale.

    El Sharpe, con la versión 3 del método (A-158): el €STR al 2 % rinde, capitalizado en act/360 entre el cierre del
    31-10-2025 y el del 30-10-2026 (364 días), 2 % × 364/360 = 2,0222 % más 0,0016 de capitalizar: 2,0238 %. El exceso
    anual es -22,0238 %. Su desviación ya no es justo 20 %: el mes que cae (del 31-10 al 28-11, 28 días) descuenta menos
    tipo que la media, y queda en 19,986 %. -22,0238 / 19,986 = -1,102. Con la versión 2 era -22/20 = -1,1."""
    from fetchers import cambios_bce
    inicio = date(2025, 1, 1)
    cambio = [(inicio + timedelta(days=i), 1.0 if inicio + timedelta(days=i) < date(2025, 11, 1) else 1.25)
              for i in range(800)]
    monkeypatch.setattr(cambios_bce, "cambios", lambda moneda, http: cambio if moneda == "USD" else [])
    _correccion_de_simbolo(tmp_path, "IE000DR59CI3", "STOR.AS")
    http = _HttpStor(_serie_plana())
    with procedencia.activa("vl_eodhd"):
        out = vl_fondos.fetch("IE000DR59CI3", http, {}, tipo="etf", base=tmp_path, previo={})

    hp = out["riesgo"]["historial_precios"]
    assert hp["source_listing_id"] == "EODHD:STOR.AS" and hp["clase_de_serie"] == "PRECIO_DE_MERCADO"
    assert (hp["first_date"], hp["last_date"]) == ("2025-02-10", "2026-11-04")
    assert (hp["divisa_metricas"], hp["divisa_origen"], hp["fx_source"]) == ("EUR", "USD", "ECB_REFERENCE")
    assert out["rentabilidad"]["fecha_dato"] == "2026-10-31"
    rent = out["rentabilidad"]["trailing_pct"]
    assert rent["1a"]["fondo"] == pytest.approx(-20.0, abs=1e-4)
    assert rent["ytd"]["fondo"] == pytest.approx(0.0, abs=1e-4)
    assert "3a_anualizada" not in rent and "5a_anualizada" not in rent
    assert out["riesgo"]["volatilidad_pct"]["1a"]["fondo"] == pytest.approx(20.0, abs=1e-3)
    assert out["riesgo"]["sharpe"]["1a"]["fondo"] == pytest.approx(-1.102, abs=1e-3)
    assert hp["metodo"] == "core.metricas v4: cierre de mes, en euros, sobre precio de mercado ajustado"
    assert out["riesgo"]["max_drawdown_pct"]["1a"]["fondo"] == pytest.approx(-20.0, abs=1e-4)
    # El precio de mercado no desplaza el VL que venga de otra fuente, y la serie es la de esa cotización.
    assert "valoracion" not in out
    assert any(p[0].endswith("/eod/STOR.AS") for p in http.peticiones)
    for ventana in ("3a", "5a"):
        assert ventana not in out["riesgo"]["volatilidad_pct"] and ventana not in out["riesgo"]["sharpe"]
        assert ventana not in out["riesgo"]["max_drawdown_pct"]


def test_un_etf_sin_correccion_no_mira_la_ficha_anterior(tmp_path):
    previo = {"_anterior": {"identificacion": {"simbolo_eodhd": "STOR.AS"}}}
    http = _HttpStor(_serie_plana())
    with procedencia.activa("vl_eodhd"):
        assert vl_fondos.fetch("IE000DR59CI3", http, {}, tipo="etf", base=tmp_path, previo=previo) == {}
    assert not any("/eod/" in p[0] for p in http.peticiones)


def test_una_clase_cubierta_no_se_mide_contra_un_proxy_sin_cubrir(tmp_path, monkeypatch):
    from core import indices
    fila = {"benchmark": "MSCI World", "variante": "NR", "proxy": "IE00B03HD191",
            "clase_de_serie": "VALOR_LIQUIDATIVO", "base": "TOTAL_RETURN"}
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    previo = {"ms": {"identificacion": {"nombre": "Fondo B EUR Acc", "indice_benchmark_oficial": "MSCI World NR USD",
                                        "clase_cubierta": True}}}
    out, _ = _fetch("LU0000000030", _Http(_serie()), previo, tmp_path)
    relativas = out["riesgo"]["relativas"]
    assert relativas == {"aviso": "sin_relativas_clase_cubierta"}


def test_el_proxy_de_mercado_se_lleva_a_euros_con_la_divisa_de_su_cotizacion(tmp_path, monkeypatch):
    """Un ETF puede resolverse a Suiza: sin convertir, la beta mediria tambien el franco."""
    carpeta = tmp_path / "data" / "funds"
    carpeta.mkdir(parents=True)
    ficha = {"identificacion": {"simbolo_eodhd": "SMCX.SW", "divisa_base": "EUR"},
             "valoracion": {"vl_divisa": "EUR"},
             "riesgo": {"historial_precios": {"divisa_metricas": "EUR", "divisa_origen": "CHF"}}}
    (carpeta / "IE00BKWQ0M75.json").write_text(json.dumps(ficha), encoding="utf-8")
    pedidas = []
    monkeypatch.setattr(vl_fondos.cambios_bce, "serie_en_euros",
                        lambda s, moneda, http: pedidas.append(moneda) or s)
    fila = {"proxy": "IE00BKWQ0M75", "clase_de_serie": "PRECIO_DE_MERCADO"}
    assert vl_fondos._serie_del_proxy(fila, _Http(_serie()), "t", False, tmp_path)
    assert pedidas == ["CHF"]

    ficha["riesgo"]["historial_precios"] = {}
    (carpeta / "IE00BKWQ0M75.json").write_text(json.dumps(ficha), encoding="utf-8")
    assert vl_fondos._serie_del_proxy(fila, _Http(_serie()), "t", False, tmp_path) == []


def test_el_proxy_de_valor_liquidativo_se_lleva_a_euros(tmp_path, monkeypatch):
    pedidas = []
    monkeypatch.setattr(vl_fondos.cambios_bce, "serie_en_euros",
                        lambda s, moneda, http: pedidas.append(moneda) or s)
    fila = {"proxy": "IE0000000001", "clase_de_serie": "VALOR_LIQUIDATIVO"}
    assert vl_fondos._serie_del_proxy(fila, _Http(_serie(), divisa="USD"), "t", False, tmp_path)
    assert pedidas == ["USD"]


def _relativas_con(fila, tmp_path, monkeypatch):
    from core import indices
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: _serie(crec=0.04))
    previo = {"ms": {"identificacion": {"nombre": "Fondo C EUR Acc",
                                        "indice_benchmark_oficial": "ICE BofA Euro Corporate TR EUR"}}}
    out, _ = _fetch("LU0000000031", _Http(_serie()), previo, tmp_path)
    return out["riesgo"]["relativas"]


def test_un_proxy_equivalente_deja_dicho_el_indice_declarado(tmp_path, monkeypatch):
    """06-11-2026. Medido contra el iBoxx, equivalente al ICE BofA que declara el fondo: las dos
    cosas viajan, cada una en su campo, para que nadie lea el índice medido por el declarado."""
    fila = {"benchmark": "Markit iBoxx EUR Liquid Corporates", "variante": "TR", "proxy": "LU0478205379",
            "clase_de_serie": "PRECIO_DE_MERCADO", "base": "TOTAL_RETURN",
            "equivalente_de": ("ICE BofA Euro Corporate",), "declarado": "ICE BofA Euro Corporate"}
    relativas = _relativas_con(fila, tmp_path, monkeypatch)
    assert relativas["indice_nombre"] == "Markit iBoxx EUR Liquid Corporates"
    assert relativas["equivalente_de"] == "ICE BofA Euro Corporate"
    assert relativas["beta"]["3a"] is not None


def test_un_proxy_directo_no_escribe_equivalencia(tmp_path, monkeypatch):
    fila = {"benchmark": "Bloomberg Euro Corp", "variante": "TR", "proxy": "IE00B3T9LM79",
            "clase_de_serie": "PRECIO_DE_MERCADO", "base": "TOTAL_RETURN",
            "equivalente_de": (), "declarado": None}
    relativas = _relativas_con(fila, tmp_path, monkeypatch)
    assert relativas["indice_nombre"] == "Bloomberg Euro Corp"
    assert "equivalente_de" not in relativas


def test_el_proxy_de_su_indice_no_se_mide_contra_si_mismo(tmp_path, monkeypatch):
    """06-11-2026. Cinco proxies publicaban beta 1 y alfa 0 contra sí mismos."""
    from core import indices
    fila = {"benchmark": "MSCI World", "variante": "NR", "proxy": "LU0000000032",
            "clase_de_serie": "VALOR_LIQUIDATIVO", "base": "TOTAL_RETURN", "declarado": None}
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: _serie())
    previo = {"ms": {"identificacion": {"nombre": "Indice World EUR Acc",
                                        "indice_benchmark_oficial": "MSCI World NR USD"}}}
    out, _ = _fetch("LU0000000032", _Http(_serie()), previo, tmp_path)
    assert "relativas" not in (out.get("riesgo") or {})
    out, _ = _fetch("LU0000000033", _Http(_serie()), previo, tmp_path)
    assert out["riesgo"]["relativas"]["indice_proxy"] == "LU0000000032"


# ---- C-28 (Óscar, 21-11-2026): tampoco contra otra clase del mismo fondo ----

_PROXY_HERMANA = "IE0000000040"
_PATRIMONIO = {"patrimonio_fondo_meur": 24320.3, "patrimonio_fecha": "2026-10-30"}
_CARTERA = {"fecha": "2026-09-30", "num_posiciones": 1261, "peso_top10_pct": 27.89487}


def _relativas_contra_la_ficha(ref: dict | None, previo: dict, tmp_path, monkeypatch,
                               clase_de_serie="VALOR_LIQUIDATIVO") -> dict:
    """Las relativas de un fondo cuyo proxy tiene en disco la ficha `ref` (sin ficha si es `None`)."""
    from core import indices
    fila = {"benchmark": "MSCI World", "variante": "NR", "proxy": _PROXY_HERMANA,
            "clase_de_serie": clase_de_serie, "base": "TOTAL_RETURN", "declarado": None}
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: _serie(crec=0.04))
    if ref is not None:
        carpeta = tmp_path / "data" / "funds"
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / f"{_PROXY_HERMANA}.json").write_text(json.dumps(ref), encoding="utf-8")
    out, _ = _fetch("IE0000000041", _Http(_serie()), previo, tmp_path)
    return out["riesgo"]["relativas"]


def _previo_hermana(gestora="Vanguard", valoracion=None, cartera=None, **otras):
    ficha = {"identificacion": {"nombre": "Global Stock Index Fund Investor EUR Accumulation", "gestora": gestora,
                                "indice_benchmark_oficial": "MSCI World NR USD"}}
    if valoracion is not None:
        ficha["valoracion"] = valoracion
    if cartera is not None:
        ficha["cartera"] = cartera
    return {"ms": ficha, **otras}


def test_otra_clase_del_mismo_fondo_por_su_patrimonio_no_se_usa_de_referencia(tmp_path, monkeypatch):
    # El caso medido: Vanguard Global Stock Index Investor contra la clase EUR Acc, el proxy de MSCI World. El patrimonio
    # del fondo entero, 24.320,3 M€ al 30-10-2026, es el mismo en las dos fichas; el de la clase, no.
    ref = {"identificacion": {"gestora": "Vanguard"}, "valoracion": _PATRIMONIO}
    relativas = _relativas_contra_la_ficha(ref, _previo_hermana(valoracion=_PATRIMONIO), tmp_path, monkeypatch)
    assert relativas == {"aviso": f"sin_relativas_referencia_del_mismo_fondo({_PROXY_HERMANA})",
                         "mismo_fondo_por": "patrimonio_del_fondo"}


def test_otra_clase_del_mismo_fondo_por_su_cartera_no_se_usa_de_referencia(tmp_path, monkeypatch):
    # Una clase en dólares da el patrimonio del fondo en dólares, y otro número: la cartera del fondo es la misma.
    ref = {"identificacion": {"gestora": "vanguard "}, "valoracion": {"patrimonio_fondo_meur": 28000.0,
                                                                    "patrimonio_fecha": "2026-10-30"},
           "cartera": _CARTERA}
    relativas = _relativas_contra_la_ficha(ref, _previo_hermana(valoracion=_PATRIMONIO, cartera=_CARTERA), tmp_path, monkeypatch)
    assert relativas["mismo_fondo_por"] == "cartera"
    assert "beta" not in relativas


def test_la_ficha_anterior_del_fondo_tambien_cuenta(tmp_path, monkeypatch):
    # La ficha de la referencia en disco puede ser de la pasada anterior: su patrimonio es de otro día que el de esta
    # pasada del fondo, pero el mismo que la ficha anterior del fondo.
    ref = {"identificacion": {"gestora": "Vanguard"}, "valoracion": _PATRIMONIO}
    previo = _previo_hermana(valoracion={"patrimonio_fondo_meur": 24410.9, "patrimonio_fecha": "2026-11-13"},
                 _anterior={"valoracion": _PATRIMONIO})
    relativas = _relativas_contra_la_ficha(ref, previo, tmp_path, monkeypatch)
    assert relativas["mismo_fondo_por"] == "patrimonio_del_fondo"


def test_el_mismo_patrimonio_de_otra_gestora_no_es_el_mismo_fondo(tmp_path, monkeypatch):
    # Medido el 21-11-2026: dos fondos de 2,15 M€ al 29-10-2026, uno de Andbank y otro de Metagestión. Se mide.
    ref = {"identificacion": {"gestora": "Metagestión"}, "valoracion": _PATRIMONIO}
    relativas = _relativas_contra_la_ficha(ref, _previo_hermana(gestora="Andbank", valoracion=_PATRIMONIO), tmp_path, monkeypatch)
    assert relativas["indice_proxy"] == _PROXY_HERMANA and relativas["beta"]["3a"] is not None


def test_otro_fondo_de_la_misma_gestora_si_se_usa_de_referencia(tmp_path, monkeypatch):
    # Una firma a medias no vale: la cartera sin el peso de las diez primeras no es la del fondo.
    ref = {"identificacion": {"gestora": "Vanguard"},
           "valoracion": {"patrimonio_fondo_meur": 7692.5, "patrimonio_fecha": "2026-10-30"},
           "cartera": {**_CARTERA, "peso_top10_pct": None}}
    previo = _previo_hermana(valoracion=_PATRIMONIO, cartera={**_CARTERA, "peso_top10_pct": None})
    relativas = _relativas_contra_la_ficha(ref, previo, tmp_path, monkeypatch)
    assert relativas["indice_proxy"] == _PROXY_HERMANA and "aviso" not in relativas


def test_sin_la_ficha_de_la_referencia_se_mide_como_antes(tmp_path, monkeypatch):
    relativas = _relativas_contra_la_ficha(None, _previo_hermana(valoracion=_PATRIMONIO), tmp_path, monkeypatch)
    assert relativas["beta"]["3a"] is not None and "aviso" not in relativas


# Lo que la ficha de Vanguard Global Stock Index Investor publicaba el 17-11-2026, recortado: contra su clase EUR Acc.
_PUBLICADAS_CONTRA_LA_HERMANA = {"valoracion": _PATRIMONIO, "riesgo": {"relativas": {
    "indice_nombre": "MSCI World", "indice_variante": "NR", "indice_proxy": _PROXY_HERMANA,
    "indice_clase_de_serie": "VALOR_LIQUIDATIVO", "base_indice": "TOTAL_RETURN", "fecha_dato": "2026-10-31",
    "beta": {"1a": 1.0, "3a": 1.0, "5a": 1.0}, "r2": {"1a": 100.0, "3a": 100.0, "5a": 100.0}}}}


def test_retirar_las_publicadas_contra_otra_clase_del_mismo_fondo_deja_su_fecha(tmp_path, monkeypatch):
    """C-28 con la §10 del método: la retirada dice hasta cuándo, contra qué y con qué dato, como la del KID."""
    monkeypatch.setattr(vl_fondos, "_hoy", lambda: date(2026, 11, 22))
    ref = {"identificacion": {"gestora": "Vanguard"}, "valoracion": _PATRIMONIO}
    previo = _previo_hermana(valoracion=_PATRIMONIO, _anterior=_PUBLICADAS_CONTRA_LA_HERMANA)
    relativas = _relativas_contra_la_ficha(ref, previo, tmp_path, monkeypatch)
    assert relativas == {
        "aviso": f"sin_relativas_referencia_del_mismo_fondo({_PROXY_HERMANA})",
        "mismo_fondo_por": "patrimonio_del_fondo",
        "retirada": {"fecha": "2026-11-22",
                     "decision": "DECISIONES_BASE_NUEVA_2026-11-01.md, decisión C-28 (regla 3)",
                     "indice_nombre": "MSCI World", "indice_proxy": _PROXY_HERMANA,
                     "indice_clase_de_serie": "VALOR_LIQUIDATIVO", "ultima_fecha_dato": "2026-10-31"}}


@pytest.mark.parametrize("proxy_anterior", [_PROXY_HERMANA, "IE0000000042"])
def test_la_retirada_por_el_mismo_fondo_no_se_mueve_aunque_cambie_el_proxy(proxy_anterior, tmp_path, monkeypatch):
    # El motivo es el mismo con otro proxy entre paréntesis: si la fila del índice pasa a otra clase del mismo fondo, las
    # cifras siguen retiradas desde el mismo día.
    ya_retirada = {"valoracion": _PATRIMONIO, "riesgo": {"relativas": {
        "aviso": f"sin_relativas_referencia_del_mismo_fondo({proxy_anterior})", "mismo_fondo_por": "patrimonio_del_fondo",
        "retirada": {"fecha": "2026-11-22", "decision": vl_fondos.DECISION_RETIRADA_MISMO_FONDO,
                     "indice_proxy": proxy_anterior, "ultima_fecha_dato": "2026-10-31"}}}}
    monkeypatch.setattr(vl_fondos, "_hoy", lambda: date(2026, 12, 20))
    ref = {"identificacion": {"gestora": "Vanguard"}, "valoracion": _PATRIMONIO}
    relativas = _relativas_contra_la_ficha(ref, _previo_hermana(valoracion=_PATRIMONIO, _anterior=ya_retirada),
                                           tmp_path, monkeypatch)
    assert relativas["retirada"] == ya_retirada["riesgo"]["relativas"]["retirada"]


def test_sin_cifras_en_la_ficha_anterior_no_hay_retirada_por_el_mismo_fondo(tmp_path, monkeypatch):
    """Decisión 17: un fondo que nunca las publicó contra su hermana no lleva retirada."""
    ref = {"identificacion": {"gestora": "Vanguard"}, "valoracion": _PATRIMONIO}
    anterior = {"valoracion": _PATRIMONIO, "riesgo": {"relativas": {"aviso": "sin_relativas_clase_cubierta"}}}
    relativas = _relativas_contra_la_ficha(ref, _previo_hermana(valoracion=_PATRIMONIO, _anterior=anterior),
                                           tmp_path, monkeypatch)
    assert relativas["mismo_fondo_por"] == "patrimonio_del_fondo" and "retirada" not in relativas


# ---- Decisiones 20 y 21 del 07-11-2026: lo que el KID dice del índice ----

_FILA_ACWI = {"benchmark": "MSCI ACWI", "variante": "NR", "proxy": "IE00B6R52259",
              "clase_de_serie": "PRECIO_DE_MERCADO", "base": "TOTAL_RETURN",
              "equivalente_de": (), "declarado": None}
_TEXTO_COMPUESTO = ("compuesto en un 50 % por el Wilderhill Clean Energy Index (ECO) y en un 50 % por el "
                    "Wilderhill New Energy Global Innovation Index (NEX)")


def _relativas_segun_kid(estado, tmp_path, monkeypatch, anterior=None, texto=_TEXTO_COMPUESTO):
    """Las relativas de un fondo cuyo KID dice `estado` del índice que le atribuye Morningstar.

    El bloque llega como lo deja `indice_kid` en esta pasada. Se cuenta si se pidió el proxy:
    con un KID compuesto o sin índice ni se busca."""
    from core import indices
    pedidos = []
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: pedidos.append(a) or _FILA_ACWI)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: _serie(crec=0.04))
    monkeypatch.setattr(vl_fondos, "_hoy", lambda: date(2026, 11, 7))
    previo = {"ms": {"identificacion": {"nombre": "Fondo K EUR Acc",
                                        "indice_benchmark_oficial": "MSCI ACWI NR EUR"}}}
    if estado is not None:
        previo["indice_kid"] = {"identificacion": {"indice_benchmark_kid": {
            "estado": estado, "texto_del_kid": texto, "indice_morningstar": "MSCI ACWI NR EUR",
            "kid_sha256": "ab" * 32, "fecha_comprobacion": "2026-11-07", "metodo": "indice_kid v1"}}}
    if anterior is not None:
        previo["_anterior"] = anterior
    out, _ = _fetch("LU0823414635", _Http(_serie()), previo, tmp_path)
    return out["riesgo"].get("relativas"), pedidos


_PUBLICADAS = {"riesgo": {"relativas": {"indice_nombre": "MSCI ACWI", "indice_proxy": "IE00B6R52259",
                                        "fecha_dato": "2026-10-31", "jensen_alpha": {"3a": -18.58},
                                        "beta": {"3a": 1.49}}}}


@pytest.mark.parametrize("estado,aviso", [("COMPUESTO", "sin_relativas_kid_compuesto"),
                                          ("KID_SIN_INDICE", "sin_relativas_kid_sin_indice")])
def test_kid_compuesto_o_sin_indice_no_calcula_y_dice_por_que(estado, aviso, tmp_path, monkeypatch):
    """Decisión 20. Ni beta ni alfa, ni se busca el proxy; queda el motivo con la frase del KID."""
    relativas, pedidos = _relativas_segun_kid(estado, tmp_path, monkeypatch)
    assert pedidos == []
    assert relativas == {"aviso": aviso, "kid_estado": estado, "kid_texto": _TEXTO_COMPUESTO,
                         "kid_sha256": "ab" * 32, "kid_fecha_comprobacion": "2026-11-07"}


def test_retirar_las_publicadas_deja_la_fecha_y_lo_que_se_retiro(tmp_path, monkeypatch):
    """§10 del método: consta desde cuándo ya no se publican, contra qué se medían y su último dato."""
    relativas, _ = _relativas_segun_kid("COMPUESTO", tmp_path, monkeypatch, anterior=_PUBLICADAS)
    assert relativas["retirada"] == {"fecha": "2026-11-07",
                                     "decision": "DECISIONES_DATOS_2026-11-07.md, punto 20",
                                     "indice_nombre": "MSCI ACWI", "indice_proxy": "IE00B6R52259",
                                     "ultima_fecha_dato": "2026-10-31"}
    for cifra in ("beta", "r2", "jensen_alpha", "rentabilidad_activa", "tracking_error", "information_ratio"):
        assert cifra not in relativas


def test_la_fecha_de_retirada_no_se_mueve_en_la_pasada_siguiente(tmp_path, monkeypatch):
    ya_retirada = {"riesgo": {"relativas": {
        "aviso": "sin_relativas_kid_compuesto", "kid_estado": "COMPUESTO",
        "retirada": {"fecha": "2026-11-07", "decision": "DECISIONES_DATOS_2026-11-07.md, punto 20",
                     "indice_proxy": "IE00B6R52259", "ultima_fecha_dato": "2026-10-31"}}}}
    monkeypatch.setattr(vl_fondos, "_hoy", lambda: date(2026, 12, 1))
    relativas, _ = _relativas_segun_kid("COMPUESTO", tmp_path, monkeypatch, anterior=ya_retirada)
    monkeypatch.undo()
    assert relativas["retirada"]["fecha"] == "2026-11-07"


def test_un_fondo_que_nunca_las_tuvo_no_lleva_retirada(tmp_path, monkeypatch):
    """Decisión 17: no se le retiró nada, así que el campo no aplica."""
    relativas, _ = _relativas_segun_kid("KID_SIN_INDICE", tmp_path, monkeypatch,
                            anterior={"riesgo": {"relativas": {"aviso": "sin_relativas_clase_cubierta"}}})
    assert "retirada" not in relativas


@pytest.mark.parametrize("estado", ["NO_CONFIRMADO", "CONFIRMADO_MARCA"])
def test_kid_que_no_confirma_el_indice_calcula_y_marca(estado, tmp_path, monkeypatch):
    """Decisión 21: se publican y se marca cuál de las dos cosas pasa."""
    relativas, pedidos = _relativas_segun_kid(estado, tmp_path, monkeypatch)
    assert len(pedidos) == 1
    assert relativas["beta"]["3a"] is not None and relativas["jensen_alpha"]["3a"] is not None
    assert relativas["kid_no_confirma"] is True and relativas["kid_estado"] == estado
    assert "aviso" not in relativas and "kid_texto" not in relativas


@pytest.mark.parametrize("estado", ["CONFIRMADO_COMPLETO", "SIN_KID", None])
def test_kid_que_confirma_o_que_no_hay_calcula_como_siempre(estado, tmp_path, monkeypatch):
    relativas, pedidos = _relativas_segun_kid(estado, tmp_path, monkeypatch)
    assert len(pedidos) == 1
    assert relativas["beta"]["3a"] is not None
    for clave in ("aviso", "kid_no_confirma", "kid_estado", "kid_texto", "retirada"):
        assert clave not in relativas


def test_el_kid_de_esta_pasada_manda_sobre_el_de_la_ficha_anterior(tmp_path, monkeypatch):
    """El KID nuevo confirma el índice: vuelven las relativas aunque la ficha anterior dijera compuesto."""
    anterior = {"identificacion": {"indice_benchmark_kid": {"estado": "COMPUESTO"}}}
    relativas, pedidos = _relativas_segun_kid("CONFIRMADO_COMPLETO", tmp_path, monkeypatch, anterior=anterior)
    assert len(pedidos) == 1 and "aviso" not in relativas


def test_sin_bloque_en_esta_pasada_vale_el_de_la_ficha_anterior(tmp_path, monkeypatch):
    anterior = {"identificacion": {"indice_benchmark_kid": {"estado": "KID_SIN_INDICE",
                                                            "texto_del_kid": "No se gestiona en relación con un valor de referencia."}}}
    relativas, pedidos = _relativas_segun_kid(None, tmp_path, monkeypatch, anterior=anterior)
    assert pedidos == [] and relativas["aviso"] == "sin_relativas_kid_sin_indice"


def test_las_relativas_corren_detras_del_contraste_del_kid():
    """Si `vl_eodhd` vuelve delante de `indice_kid`, la regla lee el KID de la pasada anterior."""
    from core.adquisicion import registro
    por_id = {a.id: a.orden for a in registro.ADAPTADORES}
    assert por_id["vl_eodhd"] > por_id["indice_kid"] > por_id["kid_gestora"]


# ---------------------------------------------- camino C: la serie del propio índice (decisión 23)
class _HttpIndice(_Http):
    """EODHD con el catálogo de la bolsa INDX; el /eod trae un ajustado distinto del cierre."""

    def __init__(self, serie, divisa_indice="USD"):
        super().__init__(serie)
        self.divisa_indice = divisa_indice

    def get(self, url, params=None, force=False, familia=None, ttl_dias=None):
        if "/exchange-symbol-list/INDX" in url:
            self.peticiones.append((url, dict(params or {}), familia))
            return _Resp([{"Code": "SP500TR", "Name": "S&P 500 TR", "Currency": self.divisa_indice},
                          {"Code": "IBEX", "Name": "IBEX 35 Index", "Currency": "EUR"}])
        if "/eod/" in url:
            self.peticiones.append((url, dict(params or {}), familia))
            return _Resp([{"date": f.isoformat(), "close": p, "adjusted_close": p * 2}
                          for f, p in self.serie])
        return super().get(url, params, force, familia)


def test_un_nivel_de_indice_lee_el_cierre_y_se_lleva_a_euros_con_la_divisa_del_catalogo(tmp_path, monkeypatch):
    pedidas = []
    monkeypatch.setattr(vl_fondos.cambios_bce, "serie_en_euros",
                        lambda s, moneda, http: pedidas.append(moneda) or s)
    http = _HttpIndice(_serie())
    fila = {"proxy": "SP500TR.INDX", "clase_de_serie": "NIVEL_DE_INDICE"}
    s = vl_fondos._serie_del_proxy(fila, http, "t", False, tmp_path)
    assert s and s[-1][1] == _serie()[-1][1], "close, no adjusted_close: un indice no se ajusta"
    assert pedidas == ["USD"]
    urls = [p[0] for p in http.peticiones]
    assert any(u.endswith("/exchange-symbol-list/INDX") for u in urls)
    assert any(u.endswith("/eod/SP500TR.INDX") for u in urls)
    assert not any("/search/" in u for u in urls), "la divisa no sale de /search, que no ve indices"


def test_un_indice_que_no_esta_en_el_catalogo_no_tiene_serie(tmp_path):
    http = _HttpIndice(_serie())
    fila = {"proxy": "SX5GT.INDX", "clase_de_serie": "NIVEL_DE_INDICE"}
    assert vl_fondos._serie_del_proxy(fila, http, "t", False, tmp_path) == []
    assert not any("/eod/" in p[0] for p in http.peticiones)


def test_la_divisa_de_un_indice_solo_se_busca_en_la_bolsa_INDX():
    http = _HttpIndice(_serie())
    assert vl_fondos.divisa_de_indice("SP500TR.INDX", http, "t") == "USD"
    assert vl_fondos.divisa_de_indice("SP500TR.XETRA", http, "t") is None
    assert vl_fondos.divisa_de_indice("SP500TR", http, "t") is None
    assert not http.peticiones[1:], "fuera de INDX no se pregunta nada"


def test_el_simbolo_de_fondo_y_el_de_indice_leen_close_y_el_de_etf_el_ajustado():
    http = _HttpIndice(_serie())
    fondo, _ = vl_fondos.serie_de_simbolo("LU0000000001.EUFUND", http, "t")
    indice, _ = vl_fondos.serie_de_simbolo("IBEX.INDX", http, "t")
    etf, _ = vl_fondos.serie_de_simbolo("EUNL.XETRA", http, "t")
    ultimo = _serie()[-1][1]
    assert fondo[-1][1] == ultimo and indice[-1][1] == ultimo
    assert etf[-1][1] == ultimo * 2


def test_la_retirada_dice_contra_que_clase_de_serie_se_median(tmp_path, monkeypatch):
    publicadas = {"riesgo": {"relativas": {"indice_nombre": "S&P 500", "indice_proxy": "SP500TR.INDX",
                                           "indice_clase_de_serie": "NIVEL_DE_INDICE",
                                           "fecha_dato": "2026-10-31", "beta": {"3a": 0.93}}}}
    relativas, _ = _relativas_segun_kid("COMPUESTO", tmp_path, monkeypatch, anterior=publicadas)
    assert relativas["retirada"]["indice_proxy"] == "SP500TR.INDX"
    assert relativas["retirada"]["indice_clase_de_serie"] == "NIVEL_DE_INDICE"


def test_las_relativas_contra_un_nivel_de_indice_declaran_su_clase(tmp_path, monkeypatch):
    fila = {"benchmark": "S&P 500", "variante": "TR", "proxy": "SP500TR.INDX",
            "clase_de_serie": "NIVEL_DE_INDICE", "base": "TOTAL_RETURN", "declarado": None}
    relativas = _relativas_con(fila, tmp_path, monkeypatch)
    assert relativas["indice_proxy"] == "SP500TR.INDX"
    assert relativas["indice_clase_de_serie"] == "NIVEL_DE_INDICE"
    assert relativas["base_indice"] == "TOTAL_RETURN"
    assert relativas["jensen_alpha"]["3a"] is not None


def test_una_clase_cubierta_por_su_nombre_no_recibe_relativas_aunque_la_ficha_anterior_lo_niegue(tmp_path, monkeypatch):
    # `derivados` deriva clase_cubierta despues de los adaptadores: en la primera pasada tras
    # arreglar el patron «AH (EUR)», la ficha anterior aun decia False y Morgan Stanley US
    # Advantage recibia relativas contra el S&P 500 en euros con R2 del 46 % (medido el 07-11-2026).
    from core import indices
    fila = {"benchmark": "S&P 500", "variante": "TR", "proxy": "SP500TR.INDX",
            "clase_de_serie": "NIVEL_DE_INDICE", "base": "TOTAL_RETURN", "declarado": None}
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: _serie(crec=0.04))
    previo = {"ms": {"identificacion": {
                  "nombre": "Morgan Stanley Investment Funds - US Advantage Fund AH (EUR) Acc",
                  "indice_benchmark_oficial": "S&P 500 (TR) (1970)"}},
              "_anterior": {"identificacion": {"clase_cubierta": False}}}
    out, _ = _fetch("LU0266117927", _Http(_serie()), previo, tmp_path)
    assert out["riesgo"]["relativas"] == {"aviso": "sin_relativas_clase_cubierta"}
