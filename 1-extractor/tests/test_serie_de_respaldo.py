# -*- coding: utf-8 -*-
"""La serie de VL con Morningstar cuando la de EODHD se para (decisiones D-9 y D-10), con HTTP de mentira.

Una prueba por regla: el empalme sin salto, la sustitución, el corte en el evento, Morningstar
que no responde y un fondo vivo que no se toca. Y lo que las rodea: dos fuentes que no cuadran de
nivel, una serie de Morningstar también parada, la exportación que la reconstruye desde sus tramos
y la lista declarada de verdad. Después, D-10: una prueba por salvaguarda del respaldo automático
y el resumen de la pasada.
"""
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import export_series, negociacion, serie_de_respaldo  # noqa: E402
from core.adquisicion import procedencia  # noqa: E402
from core.http import SinCache  # noqa: E402
from fetchers import morningstar_series, vl_fondos  # noqa: E402

ISIN = "LU0000000099"
SEC = "F0000TEST1"
DESCARGA = datetime(2026, 11, 10, 7, 0).timestamp()


class _Resp:
    def __init__(self, cuerpo, ok=True, fetched_at=DESCARGA):
        self.ok, self.status = ok, 200 if ok else 404
        self.fetched_at = fetched_at
        self.text = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)

    def json(self):
        return json.loads(self.text)


def _epoch(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)


class _Http:
    """EODHD, Morningstar y el BCE; `ms` puede ser una lista de puntos, `None` (404) o una excepción."""

    def __init__(self, eodhd, ms, divisa="EUR"):
        self.eodhd, self.ms, self.divisa = eodhd, ms, divisa
        self.peticiones = []

    def get(self, url, params=None, force=False, familia=None, ttl_dias=None):
        self.peticiones.append((url, dict(params or {})))
        if "/eod/" in url:
            return _Resp([{"date": f.isoformat(), "close": p, "adjusted_close": p} for f, p in self.eodhd])
        if "/search/" in url:
            if self.divisa is None:
                return _Resp([])                      # como hoy con los once: EODHD ya no los lista
            return _Resp([{"Code": url.rsplit("/", 1)[1], "Exchange": "EUFUND", "Currency": self.divisa}])
        if "timeseries_price" in url:
            if isinstance(self.ms, Exception):
                raise self.ms
            if self.ms is None:
                return _Resp([], ok=False)
            return _Resp([[_epoch(f), p] for f, p in self.ms])
        if "/EST/" in url:
            filas = ["TIME_PERIOD,OBS_VALUE"] + [
                f"{date(2019, 10, 1) + timedelta(days=i)},2.0" for i in range(2700)]
            return _Resp("\n".join(filas))
        raise AssertionError(url)

    def pidio_morningstar(self) -> bool:
        return any("timeseries_price" in url for url, _p in self.peticiones)


def _serie(desde: date, hasta: date, crec=0.05, base=100.0):
    out, d = [], desde
    while d <= hasta:
        if d.weekday() < 5:
            out.append((d, round(base * (1 + crec) ** ((d - desde).days / 365), 4)))
        d += timedelta(days=1)
    return out


INICIO, CORTE_EODHD, HOY = date(2019, 1, 2), date(2025, 6, 30), date(2026, 11, 9)
COMPLETA = _serie(INICIO, HOY)
EODHD_PARADA = [p for p in COMPLETA if p[0] <= CORTE_EODHD]


@pytest.fixture(autouse=True)
def _token(monkeypatch):
    monkeypatch.setenv("EODHD_API_TOKEN", "tok-secreto")


def _config(base: Path, regla="empalme", isin=ISIN):
    (base / "config").mkdir(exist_ok=True)
    (base / "config" / "serie_de_respaldo.json").write_text(json.dumps(
        {"fondos": {isin: {"regla": regla, "motivo": "prueba"}}}), encoding="utf-8")


PREVIO = {"morningstar_lt": {"meta": {"sec_id_morningstar": SEC}},
          "amf_geco": {"identificacion": {"politica_distribucion": "acumulacion", "nombre": "Fondo X EUR Acc"}}}


def _fetch(http, base, previo=PREVIO):
    with procedencia.activa("vl_eodhd") as reg:
        out = vl_fondos.fetch(ISIN, http, {}, base=base, tipo="fondo", previo=previo)
    return out, reg


# --------------------------------------------------------------------- las tres reglas
def test_empalme_sin_salto_eodhd_hasta_su_corte_y_morningstar_despues(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, COMPLETA)
    out, reg = _fetch(http, tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert "aviso_vl" not in hp
    assert hp["source_history"] == "eodhd+morningstar"
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    eod, ms = hp["tramos"]
    assert (eod["fuente"], eod["hasta"], eod["puntos"]) == ("eodhd", CORTE_EODHD.isoformat(), len(EODHD_PARADA))
    assert ms["fuente"] == "morningstar" and ms["desde"] > CORTE_EODHD.isoformat()
    assert ms["hasta"] == HOY.isoformat()
    assert hp["observations_count"] == eod["puntos"] + ms["puntos"] == len(COMPLETA)
    assert hp["respaldo"] == {"regla": "empalme", "decision": "D-9", "divisa": "EUR",
                              "eodhd_hasta": CORTE_EODHD.isoformat(),
                              "eodhd_dias_parada": (date(2026, 11, 10) - CORTE_EODHD).days,
                              "divisa_de": "eodhd_search"}
    # El VL es el último de Morningstar, y las métricas salen como las de una serie viva.
    assert out["valoracion"]["vl_fecha"] == HOY.isoformat()
    assert out["rentabilidad"]["fecha_dato"] == "2026-10-31"
    assert out["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == pytest.approx(5.0, abs=0.1)
    assert out["riesgo"]["sharpe"]["3a"]["fondo"] is not None
    assert "aviso_serie" not in hp                                     # sin salto de nivel
    # Cada cosa dice de dónde sale.
    assert reg.resuelve("valoracion.vl") == "vl_eodhd:morningstar_timeseries"
    assert reg.resuelve("rentabilidad.fecha_dato") == "vl_eodhd:eod+morningstar_timeseries"
    assert reg.resuelve("riesgo.historial_precios.tramos") == "vl_eodhd:eod+morningstar_timeseries"
    # Ningún punto de EODHD se cambia: el tramo de EODHD es su serie tal cual.
    assert all("tok-secreto" not in url for url, _p in http.peticiones)


def test_sustitucion_toda_la_serie_de_morningstar_y_ningun_punto_de_eodhd(tmp_path):
    _config(tmp_path, "sustitucion")
    # EODHD con días que no cuadran lejos del corte (como Carmignac Investissement en 2021-2025).
    eodhd = [(f, p * 1.02 if date(2021, 7, 1) <= f <= date(2021, 7, 31) else p) for f, p in EODHD_PARADA]
    out, reg = _fetch(_Http(eodhd, COMPLETA), tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert hp["source_history"] == "morningstar"
    assert hp["source_listing_id"] == f"MORNINGSTAR:{SEC}"
    assert [t["fuente"] for t in hp["tramos"]] == ["morningstar"]
    assert hp["first_date"] == INICIO.isoformat() and hp["observations_count"] == len(COMPLETA)
    assert hp["respaldo"]["regla"] == "sustitucion"
    assert reg.resuelve("rentabilidad.fecha_dato") == "vl_eodhd:morningstar_timeseries"


def test_corte_en_el_evento_la_serie_se_publica_entera_y_las_metricas_miden_desde_la_ruptura(tmp_path):
    # Una suspensión y una reapertura con el VL a un 40 %: lo de antes no es rentabilidad. No se borra
    # nada de la serie (Dirección, 11-11-2026); lo corta la regla de ruptura del método, como en todos.
    evento = date(2022, 7, 18)
    con_evento = [(f, p if f < evento else round(p * 0.4, 4)) for f, p in COMPLETA
                  if not (date(2022, 2, 26) <= f < evento)]
    _config(tmp_path, "empalme")
    out, _reg = _fetch(_Http([p for p in con_evento if p[0] <= CORTE_EODHD], con_evento), tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert hp["first_date"] == INICIO.isoformat() and hp["observations_count"] == len(con_evento)
    assert hp["aviso_serie"] == f"ruptura_serie({evento.isoformat()})"
    assert "corte_en_el_evento" not in hp["respaldo"]
    t = out["rentabilidad"]["trailing_pct"]
    assert "3a_anualizada" in t and "5a_anualizada" not in t          # 4,3 años desde el evento
    assert out["riesgo"]["max_drawdown_pct"]["3a"]["fondo"] > -10        # la caída del 60 % no entra


def test_corte_en_el_evento_con_eodhd_parada_antes_del_evento(tmp_path):
    """La A1 de Schroder: EODHD se paró antes del evento, así que lo que se mide es solo de Morningstar."""
    evento = date(2022, 7, 18)
    con_evento = [(f, p if f < evento else round(p * 0.4, 4)) for f, p in COMPLETA
                  if not (date(2022, 2, 26) <= f < evento)]
    _config(tmp_path, "empalme")
    out, _reg = _fetch(_Http([p for p in con_evento if p[0] <= date(2022, 2, 25)], con_evento), tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    eod, ms = hp["tramos"]
    assert eod["hasta"] == "2022-02-25" and ms["desde"] == evento.isoformat()
    assert hp["aviso_serie"] == f"ruptura_serie({evento.isoformat()})"


# ------------------------------------- huecos y cierre del tramo de EODHD (Óscar, 11-11-2026)
HUECO = (date(2024, 3, 1), date(2024, 5, 31))           # 91 días sin un punto de EODHD
CON_HUECO = [p for p in EODHD_PARADA if not (HUECO[0] < p[0] < HUECO[1])]


def test_un_hueco_de_eodhd_se_rellena_con_morningstar_y_cada_punto_dice_su_fuente(tmp_path):
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(CON_HUECO, COMPLETA), tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert [t["fuente"] for t in hp["tramos"]] == ["eodhd", "morningstar", "eodhd", "morningstar"]
    relleno = hp["tramos"][1]
    assert relleno["desde"] > HUECO[0].isoformat() and relleno["hasta"] < HUECO[1].isoformat()
    assert relleno["puntos"] == sum(1 for f, _p in COMPLETA if HUECO[0] < f < HUECO[1])
    assert hp["observations_count"] == len(COMPLETA) and "huecos" not in hp
    # La identidad de la serie no cambia por tener cuatro tramos: son los mismos dos listados.
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    assert hp["source_history"] == "eodhd+morningstar"
    assert "5a_anualizada" in out["rentabilidad"]["trailing_pct"]


def test_un_hueco_donde_no_cuadran_se_queda_como_esta(tmp_path):
    # Morningstar un 5 % por encima en los meses de alrededor del hueco: no se sabe cuál dice la verdad.
    raro = (HUECO[0] - timedelta(days=120), HUECO[1] + timedelta(days=120))
    ms = [(f, round(p * 1.05, 4) if raro[0] <= f <= raro[1] else p) for f, p in COMPLETA]
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(CON_HUECO, ms), tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert [t["fuente"] for t in hp["tramos"]] == ["eodhd", "morningstar"]
    assert hp["tramos"][0]["puntos"] == len(CON_HUECO)
    assert hp["huecos"][0]["dias"] > 31                    # el método lo sigue contando


def test_el_tramo_de_eodhd_se_cierra_en_su_ultimo_dia_comun_con_morningstar(tmp_path):
    """Como LU1683285321: sus dos últimos puntos de EODHD no coinciden con Morningstar."""
    malos = {EODHD_PARADA[-1][0], EODHD_PARADA[-2][0]}
    eodhd = [(f, round(p * 0.975, 4) if f in malos else p) for f, p in EODHD_PARADA]
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(eodhd, COMPLETA), tmp_path)
    eod, ms = out["riesgo"]["historial_precios"]["tramos"]
    assert eod["hasta"] == EODHD_PARADA[-3][0].isoformat()
    assert ms["desde"] == EODHD_PARADA[-2][0].isoformat()
    # Lo que queda en esos dos días es lo de Morningstar, no el dato erróneo.
    assert out["riesgo"]["historial_precios"]["respaldo"]["eodhd_hasta"] == CORTE_EODHD.isoformat()
    assert serie_de_respaldo.ultimo_dia_comun(eodhd, COMPLETA) == EODHD_PARADA[-3][0]


def test_un_fondo_sin_huecos_y_con_el_ultimo_dia_bueno_sale_igual_que_antes():
    """La regla anterior: EODHD entero y Morningstar después. Sin huecos ni último dato malo, idéntico."""
    c = serie_de_respaldo.compone("empalme", EODHD_PARADA, f"{ISIN}.EUFUND", COMPLETA, SEC, "EUR")
    antes = EODHD_PARADA + [p for p in COMPLETA if p[0] > CORTE_EODHD]
    assert c.serie == antes
    assert [(t.fuente, t.desde, t.hasta, t.puntos) for t in c.tramos] == [
        ("eodhd", INICIO, CORTE_EODHD, len(EODHD_PARADA)),
        ("morningstar", antes[len(EODHD_PARADA)][0], HOY, len(antes) - len(EODHD_PARADA))]
    assert serie_de_respaldo.rellenos(EODHD_PARADA, COMPLETA) == []


def test_la_exportacion_reconstruye_una_serie_de_cuatro_tramos(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(CON_HUECO, COMPLETA)
    out, _ = _fetch(http, tmp_path)
    destino = tmp_path / "export_series"
    destino.mkdir()
    resultado = export_series.exporta_fila({"_id": ISIN, **out}, http, "tok-secreto", destino)
    assert resultado["estado"] == "exportada" and resultado["diferencias"] == []
    doc = json.loads((destino / f"{ISIN}.json").read_text(encoding="utf-8"))
    assert [s["source"] for s in doc["segments"]] == ["eodhd", "morningstar", "eodhd", "morningstar"]
    assert doc["points"] == [[f.isoformat(), p] for f, p in COMPLETA]


# ----------------------------------------------- lo que deja el fondo exactamente como estaba
def _como_estaba(tmp_path, eodhd=EODHD_PARADA):
    sin_lista = tmp_path / "sin_lista"
    sin_lista.mkdir()
    out, _ = _fetch(_Http(eodhd, None), sin_lista)
    return out


@pytest.mark.parametrize("respuesta", [None, ConnectionError("caido"), SinCache("sin red")])
def test_si_morningstar_no_responde_el_fondo_queda_como_estaba(tmp_path, respuesta):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, respuesta)
    out, _ = _fetch(http, tmp_path)
    assert http.pidio_morningstar()
    assert out == _como_estaba(tmp_path)
    assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")
    assert "valoracion" not in out and "rentabilidad" not in out


def test_un_fondo_vivo_no_se_toca_aunque_este_en_la_lista(tmp_path):
    _config(tmp_path, "sustitucion")
    http = _Http(COMPLETA, COMPLETA)
    out, reg = _fetch(http, tmp_path)
    assert not http.pidio_morningstar()
    hp = out["riesgo"]["historial_precios"]
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND" and hp["source_history"] == "eodhd"
    assert "tramos" not in hp and "respaldo" not in hp
    assert reg.resuelve("valoracion.vl") == "vl_eodhd:eod"
    sin_lista = tmp_path / "sin_lista"
    sin_lista.mkdir()
    assert out == _fetch(_Http(COMPLETA, None), sin_lista)[0]


def test_si_no_cuadran_de_nivel_no_se_empalma(tmp_path):
    """Morningstar en otra divisa: todos los días un 8 % arriba. Un día malo suelto, en cambio, sí pasa."""
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(EODHD_PARADA, [(f, round(p * 1.08, 4)) for f, p in COMPLETA]), tmp_path)
    assert out == _como_estaba(tmp_path)
    con_un_dia_malo = [(f, p * (0.975 if f == CORTE_EODHD else 1)) for f, p in EODHD_PARADA]
    out, _ = _fetch(_Http(con_un_dia_malo, COMPLETA), tmp_path)
    assert out["riesgo"]["historial_precios"]["source_history"] == "eodhd+morningstar"


def test_si_morningstar_tambien_esta_parada_no_revive_nada(tmp_path):
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(EODHD_PARADA, [p for p in COMPLETA if p[0] <= date(2026, 9, 30)]), tmp_path)
    assert out == _como_estaba(tmp_path)


def test_sin_secid_no_se_pide_nada(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, COMPLETA)
    out, _ = _fetch(http, tmp_path, previo={})
    assert not http.pidio_morningstar()
    assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")


def test_la_clase_en_dolares_se_pide_en_dolares(tmp_path, monkeypatch):
    from fetchers import cambios_bce
    monkeypatch.setattr(cambios_bce, "cambios", lambda moneda, http: [(date(1999, 1, 4), 1.1)] + [
        (date(2019, 1, 1) + timedelta(days=3 * i), 1.1) for i in range(800)])
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, COMPLETA, divisa="USD")
    out, _ = _fetch(http, tmp_path)
    pedidas = [p["currencyId"] for url, p in http.peticiones if "timeseries_price" in url]
    assert pedidas == ["USD"]
    hp = out["riesgo"]["historial_precios"]
    assert hp["respaldo"]["divisa"] == "USD" and hp["divisa_origen"] == "USD" and hp["divisa_metricas"] == "EUR"


def test_sin_la_divisa_de_eodhd_se_pide_en_la_del_vl_que_publica_morningstar(tmp_path):
    _config(tmp_path, "empalme")
    previo = {**PREVIO, "morningstar_lt": {"meta": {"sec_id_morningstar": SEC},
                                           "valoracion": {"vl_divisa": "EUR"}}}
    http = _Http(EODHD_PARADA, COMPLETA, divisa=None)
    out, reg = _fetch(http, tmp_path, previo=previo)
    assert [p["currencyId"] for url, p in http.peticiones if "timeseries_price" in url] == ["EUR"]
    hp = out["riesgo"]["historial_precios"]
    assert hp["respaldo"]["divisa_de"] == "morningstar_vl_divisa" and out["valoracion"]["vl_divisa"] == "EUR"
    assert reg.resuelve("valoracion.vl_divisa") == "vl_eodhd:morningstar_timeseries"


def test_sin_ninguna_divisa_no_se_pide_nada(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, COMPLETA, divisa=None)
    out, _ = _fetch(http, tmp_path)
    assert not http.pidio_morningstar()
    assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")


# ------------------------------------------- D-10: el respaldo automático, salvaguarda a salvaguarda
def _sin_lista(tmp_path: Path, excluidos: dict | None = None) -> Path:
    """Una base cuya lista declara otro fondo: el de la prueba solo puede entrar por el automático."""
    base = tmp_path / "base_d10"
    (base / "config").mkdir(parents=True)
    tabla = {"fondos": {"LU0000000098": {"regla": "sustitucion", "motivo": "otro"}}}
    if excluidos is not None:
        tabla["excluidos_del_automatico"] = excluidos
    (base / "config" / "serie_de_respaldo.json").write_text(json.dumps(tabla), encoding="utf-8")
    return base


def _anotado(http) -> tuple[str, str]:
    (fila,) = serie_de_respaldo.anotados(http)
    return fila["via"], fila["motivo"]


def test_d10_un_fondo_de_la_lista_usa_su_regla_y_no_el_automatico(tmp_path):
    """La lista manda: su regla, su decisión y nada de D-10 en la traza, aunque haya una ruptura."""
    evento = date(2022, 7, 18)
    con_evento = [(f, p if f < evento else round(p * 0.4, 4)) for f, p in COMPLETA
                  if not (date(2022, 2, 26) <= f < evento)]
    _config(tmp_path, "sustitucion")
    http = _Http([p for p in con_evento if p[0] <= CORTE_EODHD], con_evento)
    out, _ = _fetch(http, tmp_path)
    hp = out["riesgo"]["historial_precios"]
    assert hp["source_history"] == "morningstar"                       # su regla, no el empalme
    assert hp["respaldo"]["decision"] == "D-9"
    assert "aplicacion" not in hp["respaldo"] and "nivel" not in hp["respaldo"]
    assert "respaldo_pendiente" not in hp
    assert hp["aviso_serie"] == f"ruptura_serie({evento.isoformat()})"  # la corta el método, como en D-9
    assert _anotado(http) == ("lista", "aplicado")


def test_d10_un_fondo_de_la_lista_que_no_cuadra_no_cae_al_automatico(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, [(f, round(p * 1.08, 4)) for f, p in COMPLETA])
    out, _ = _fetch(http, tmp_path)
    assert out == _como_estaba(tmp_path)
    assert serie_de_respaldo.anotados(http)[0]["via"] == "lista"
    assert sum(1 for url, _p in http.peticiones if "timeseries_price" in url) == 1


def test_d10_un_fondo_que_cuadra_entra_por_el_automatico_y_lo_dice(tmp_path):
    base = _sin_lista(tmp_path)
    http = _Http(EODHD_PARADA, COMPLETA)
    out, reg = _fetch(http, base)
    hp = out["riesgo"]["historial_precios"]
    assert "aviso_vl" not in hp and "respaldo_pendiente" not in hp
    # Siempre empalme: EODHD hasta su último día común y Morningstar después, cada tramo con su fuente.
    assert hp["source_history"] == "eodhd+morningstar"
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    assert [(t["fuente"], t["serie"]) for t in hp["tramos"]] == [
        ("eodhd", f"EODHD:{ISIN}.EUFUND"), ("morningstar", f"MORNINGSTAR:{SEC}")]
    r = hp["respaldo"]
    assert (r["regla"], r["decision"], r["aplicacion"]) == ("empalme", "D-10", "respaldo automático D-10")
    assert r["nivel"].startswith("mediana 0.0000% en 60 dias comunes")
    assert r["eodhd_hasta"] == CORTE_EODHD.isoformat() and r["divisa"] == "EUR"
    # Y todo lo de abajo, como con la lista: el VL de Morningstar y las métricas de la serie compuesta.
    assert out["valoracion"]["vl_fecha"] == HOY.isoformat()
    assert out["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == pytest.approx(5.0, abs=0.1)
    assert reg.resuelve("rentabilidad.fecha_dato") == "vl_eodhd:eod+morningstar_timeseries"
    assert _anotado(http) == ("automatico", "aplicado")
    # Con la misma serie, por la lista con empalme sale lo mismo salvo lo que dice D-10.
    _config(tmp_path, "empalme")
    por_lista, _ = _fetch(_Http(EODHD_PARADA, COMPLETA), tmp_path)
    for k in ("decision", "aplicacion", "nivel"):
        por_lista["riesgo"]["historial_precios"]["respaldo"].pop(k, None)
        hp["respaldo"].pop(k)
    assert out == por_lista


def test_d10_si_morningstar_no_llega_mas_lejos_no_se_hace_nada(tmp_path):
    """Como LU1066281574: Morningstar acaba el mismo día que EODHD."""
    base = _sin_lista(tmp_path)
    http = _Http(EODHD_PARADA, [p for p in COMPLETA if p[0] <= CORTE_EODHD])
    out, _ = _fetch(http, base)
    assert out == _como_estaba(tmp_path)
    assert _anotado(http) == ("automatico", "morningstar_no_llega_mas_lejos")


def test_d10_si_morningstar_tambien_esta_parada_no_se_hace_nada(tmp_path):
    """Como las tres clases C de Amundi: Morningstar llega más lejos, pero también se paró."""
    base = _sin_lista(tmp_path)
    http = _Http(EODHD_PARADA, [p for p in COMPLETA if p[0] <= date(2025, 11, 28)])
    out, _ = _fetch(http, base)
    assert out == _como_estaba(tmp_path)
    assert _anotado(http) == ("automatico", "morningstar_parada")


@pytest.mark.parametrize("ms", [
    [(f, round(p * 1.002, 4)) for f, p in COMPLETA],                     # un 0,2 %: otra clase o divisa
    [p for p in COMPLETA if p[0] <= date(2019, 1, 20) or p[0] > CORTE_EODHD],  # 13 dias comunes
])
def test_d10_si_el_nivel_no_cuadra_no_se_hace_nada(tmp_path, ms):
    base = _sin_lista(tmp_path)
    http = _Http(EODHD_PARADA, ms)
    out, _ = _fetch(http, base)
    assert out == _como_estaba(tmp_path)
    assert _anotado(http) == ("automatico", "nivel_no_cuadra")


def test_d10_una_ruptura_deja_el_fondo_como_estaba_y_para_decidir(tmp_path):
    """Como las Schroder: el automático no decide si un salto es un evento. Lo deja escrito."""
    evento = date(2022, 7, 18)
    con_evento = [(f, p if f < evento else round(p * 0.4, 4)) for f, p in COMPLETA
                  if not (date(2022, 2, 26) <= f < evento)]
    base = _sin_lista(tmp_path)
    eodhd = [p for p in con_evento if p[0] <= CORTE_EODHD]
    http = _Http(eodhd, con_evento)
    out, reg = _fetch(http, base)
    hp = out["riesgo"]["historial_precios"]
    pendiente = hp.pop("respaldo_pendiente")
    assert out == _como_estaba(tmp_path, eodhd)                          # nada más cambia
    assert hp["aviso_vl"].startswith("serie_parada(") and "valoracion" not in out
    assert pendiente["motivo"] == "ruptura: requiere decisión" and pendiente["decision"] == "D-10"
    assert pendiente["ruptura"] == evento.isoformat() and pendiente["morningstar_hasta"] == HOY.isoformat()
    assert pendiente["serie"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    assert reg.resuelve("riesgo.historial_precios.respaldo_pendiente") == "vl_eodhd:morningstar_timeseries"
    assert _anotado(http) == ("automatico", "ruptura_requiere_decision")


def test_d10_un_etf_o_una_accion_no_entran(tmp_path, monkeypatch):
    from fetchers import eodhd
    monkeypatch.setattr(eodhd, "listado_de_etf", lambda *a, **k: {"Code": "XXXX", "Exchange": "XETRA",
                                                                  "Currency": "EUR"})
    monkeypatch.setattr(eodhd, "simbolo_conocido", lambda *a, **k: None)
    base = _sin_lista(tmp_path)
    for tipo in ("etf", "accion"):
        http = _Http(EODHD_PARADA, COMPLETA)
        with procedencia.activa("vl_eodhd"):
            out = vl_fondos.fetch(ISIN, http, {}, base=base, tipo=tipo, previo=PREVIO)
        assert not http.pidio_morningstar() and serie_de_respaldo.anotados(http) == []
        if tipo == "etf":
            assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")
            assert "respaldo" not in out["riesgo"]["historial_precios"]
        else:
            assert out == {}


def test_d10_sin_secid_no_se_pide_nada(tmp_path):
    base = _sin_lista(tmp_path)
    previo = {"amf_geco": PREVIO["amf_geco"]}
    http = _Http(EODHD_PARADA, COMPLETA)
    out, _ = _fetch(http, base, previo=previo)
    assert not http.pidio_morningstar()
    assert not any("/search/" in url for url, _p in http.peticiones)      # ni la divisa se pregunta
    assert out["riesgo"]["historial_precios"]["aviso_vl"].startswith("serie_parada(")
    assert _anotado(http) == ("automatico", "sin_secid")


@pytest.mark.parametrize("respuesta", [None, [], ConnectionError("caido"), SinCache("sin red")])
def test_d10_si_morningstar_no_responde_el_fondo_queda_como_estaba(tmp_path, respuesta):
    base = _sin_lista(tmp_path)
    http = _Http(EODHD_PARADA, respuesta)
    out, _ = _fetch(http, base)
    assert http.pidio_morningstar()
    assert out == _como_estaba(tmp_path)
    assert _anotado(http) == ("automatico", "morningstar_no_responde")


def test_d10_un_fondo_vivo_no_se_toca(tmp_path):
    base = _sin_lista(tmp_path)
    http = _Http(COMPLETA, COMPLETA)
    out, reg = _fetch(http, base)
    assert not http.pidio_morningstar() and serie_de_respaldo.anotados(http) == []
    hp = out["riesgo"]["historial_precios"]
    assert hp["source_listing_id"] == f"EODHD:{ISIN}.EUFUND" and "respaldo" not in hp
    assert reg.resuelve("valoracion.vl") == "vl_eodhd:eod"


def test_d10_un_fondo_excluido_no_entra_aunque_cuadre(tmp_path):
    base = _sin_lista(tmp_path, {ISIN: {"motivo": "clase convertida", "fecha": "2026-11-11", "decision": "prueba"}})
    http = _Http(EODHD_PARADA, COMPLETA)
    out, _ = _fetch(http, base)
    assert not http.pidio_morningstar()
    assert out == _como_estaba(tmp_path)
    assert _anotado(http) == ("excluido", "excluido_del_automatico")


def test_d10_el_resumen_de_la_pasada_cuenta_cada_via_y_cada_salvaguarda(tmp_path):
    """Una sola sesión para cuatro fondos parados: uno por la lista, uno automático y dos fuera."""
    lista, auto, corto, sin_sec = "LU0000000001", "LU0000000002", "LU0000000003", "LU0000000004"
    base = tmp_path / "pasada"
    (base / "config").mkdir(parents=True)
    (base / "config" / "serie_de_respaldo.json").write_text(json.dumps(
        {"fondos": {lista: {"regla": "empalme", "motivo": "prueba"}}}), encoding="utf-8")

    class _Pasada(_Http):
        def get(self, url, params=None, **kw):
            if "timeseries_price" in url and self.isin == corto:
                return _Resp([[_epoch(f), p] for f, p in EODHD_PARADA])
            return super().get(url, params, **kw)

    http = _Pasada(EODHD_PARADA, COMPLETA)
    for isin in (lista, auto, corto, sin_sec):
        http.isin = isin
        with procedencia.activa("vl_eodhd"):
            vl_fondos.fetch(isin, http, {}, base=base, tipo="fondo", previo={} if isin == sin_sec else PREVIO)
    with procedencia.activa("vl_eodhd"):                                  # uno vivo no cuenta
        vl_fondos.fetch("LU0000000005", _Http(COMPLETA, COMPLETA), {}, base=base, tipo="fondo", previo=PREVIO)
    c = serie_de_respaldo.cuenta(http)
    assert c["parados"] == 4 and c["lista"] == [lista] and c["automatico"] == [auto]
    assert c["fuera"] == {"automatico:morningstar_no_llega_mas_lejos": [corto], "automatico:sin_secid": [sin_sec]}
    texto = serie_de_respaldo.resumen(http)
    assert "4 fondos con la serie de EODHD parada" in texto
    assert re.search(r"por la lista \(D-9\)\s+1$", texto, re.M)
    assert re.search(rf"por el automatico \(D-10\)\s+1\s+{auto}$", texto, re.M)
    assert re.search(r"^\s+fuera\s+2$", texto, re.M)
    assert re.search(rf"automatico:sin_secid\s+1\s+{sin_sec}$", texto, re.M)
    assert serie_de_respaldo.resumen(_Http(COMPLETA, COMPLETA)) == ""      # sin parados, sin bloque


def test_la_lista_de_excluidos_dice_por_que_y_desde_cuando():
    base = Path(__file__).resolve().parents[1]
    fuera = serie_de_respaldo.excluidos(base)
    assert all(isinstance(e, dict) and e.get("motivo") and e.get("fecha") for e in fuera.values())
    assert not set(fuera) & set(serie_de_respaldo.declarados(base))       # nadie en las dos


# ------------------------------------------------------------------- la exportación
def test_la_exportacion_reconstruye_la_serie_desde_sus_tramos(tmp_path):
    _config(tmp_path, "empalme")
    http = _Http(EODHD_PARADA, COMPLETA)
    out, _ = _fetch(http, tmp_path)
    fila = {"_id": ISIN, **out}
    destino = tmp_path / "export_series"
    destino.mkdir()
    resultado = export_series.exporta_fila(fila, http, "tok-secreto", destino)
    assert resultado["estado"] == "exportada" and resultado["diferencias"] == []
    doc = json.loads((destino / f"{ISIN}.json").read_text(encoding="utf-8"))
    assert doc["series_id"] == f"EODHD:{ISIN}.EUFUND+MORNINGSTAR:{SEC}"
    assert doc["source"] == "eodhd+morningstar" and doc["price_class"] == "NAV"
    assert [s["source"] for s in doc["segments"]] == ["eodhd", "morningstar"]
    assert sum(s["observations"] for s in doc["segments"]) == len(doc["points"]) == len(COMPLETA)
    assert doc["points"] == [[f.isoformat(), p] for f, p in COMPLETA]
    assert negociacion.de_ficha(fila, None) is None


def test_la_exportacion_de_una_serie_de_eodhd_no_cambia(tmp_path):
    http = _Http(COMPLETA, None)
    out, _ = _fetch(http, tmp_path)
    destino = tmp_path / "export_series"
    destino.mkdir()
    export_series.exporta_fila({"_id": ISIN, **out}, http, "tok-secreto", destino)
    doc = json.loads((destino / f"{ISIN}.json").read_text(encoding="utf-8"))
    assert "segments" not in doc and doc["source"] == "eodhd" and doc["series_id"] == f"EODHD:{ISIN}.EUFUND"


def test_la_exportacion_sin_la_respuesta_de_morningstar_lo_dice(tmp_path):
    _config(tmp_path, "empalme")
    out, _ = _fetch(_Http(EODHD_PARADA, COMPLETA), tmp_path)
    destino = tmp_path / "export_series"
    destino.mkdir()
    resultado = export_series.exporta_fila({"_id": ISIN, **out}, _Http(EODHD_PARADA, SinCache("x")),
                                           "tok-secreto", destino)
    assert resultado["estado"] == "sin_cache"


# ------------------------------------------------------------------- piezas sueltas
def test_la_respuesta_de_morningstar_se_lee_en_utc_y_lo_raro_no_entra():
    crudo = [[_epoch(date(2026, 11, 9)), 148.67], [_epoch(date(2026, 11, 6)), 148.1],
             ["x", 1], [_epoch(date(2026, 11, 5)), None], [True, 3], [_epoch(date(2026, 11, 4)), 0]]
    assert morningstar_series.lee(crudo) == [(date(2026, 11, 6), 148.1), (date(2026, 11, 9), 148.67)]
    assert morningstar_series.lee({"error": "x"}) == []


def test_la_peticion_no_lleva_la_fecha_de_hoy():
    """Sin `endDate`: con él la clave de la caché cambiaría cada día y el export sin red no la vería."""
    assert "endDate" not in morningstar_series.parametros(SEC, "EUR")


def test_la_lista_declarada_son_los_once_de_d9_y_la_ampliacion():
    """Los once de D-9 y LU0171283459, que Óscar añadió el mismo día. Los otros parados no entran."""
    base = Path(__file__).resolve().parents[1]
    fondos = serie_de_respaldo.declarados(base)
    assert sorted(fondos) == sorted([
        "LU0133716950", "LU0592699093", "LU0106819104", "LU0501220429", "FR0010312660", "IE00B52VLZ70",
        "IE00B3NLSS43", "LU2050929277", "LU1683285321", "LU0769137737", "IE00BF0GL212", "LU0171283459"])
    assert not {"LU1066281574", "LU2240056445", "LU1882457739", "LU1883319474", "LU1883342880"} & set(fondos)
    assert {i: serie_de_respaldo.regla_de(i, base) for i in fondos} == {
        i: ("sustitucion" if i == "FR0010312660" else "empalme") for i in fondos}
    assert all(f.get("motivo") for f in fondos.values())
