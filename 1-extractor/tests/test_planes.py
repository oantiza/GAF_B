# -*- coding: utf-8 -*-
"""El catálogo de planes de pensiones y EPSV (decisión D-11).

Lo que tiene que ser verdad: cada producto dice si es un plan de pensiones o una EPSV, y si las
dos señales no coinciden no entra; las cifras son las de la fuente, sin ceros ni nulos donde
falta el dato; la serie se reduce al último valor de cada mes; y una lista a medias no escribe
un catálogo.
"""
import datetime as dt
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import planes  # noqa: E402
from core.http import SinCache  # noqa: E402
from fetchers import morningstar_planes  # noqa: E402


def _ms(dia: str) -> int:
    return int(dt.datetime.fromisoformat(dia).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def _fila(n: int, **cambios) -> dict:
    """Un plan de pensiones corriente, con todos los campos."""
    fila = {
        "SecId": f"F0GBR0{n:04d}", "Name": f"Plan {n:03d} PP", "LegalName": f"Plan {n:03d}, Plan de Pensiones",
        "DGSCode": f"N{n:04d}", "AdministratorCompanyName": "Gestora de Prueba", "CategoryName": "Mixtos Moderados",
        "StarRatingM255": 3, "StarRatingDate": "2026-10-31T00:00:00", "Currency": "EUR",
        "InceptionDate": "2001-05-07T00:00:00", "TrailingDate": "2026-11-09T00:00:00",
        "ClosePrice": 12.3456, "ClosePriceDate": "2026-11-10T00:00:00", "FundTNAV": 25000000.0,
        "ReturnM1": 0.5, "ReturnM6": 2.1, "ReturnM0": 4.2, "ReturnM12": 6.3, "ReturnM36": 3.03, "ReturnM60": 2.2,
        "ReturnM120": 1.9, "StandardDeviationM12": 5.5, "StandardDeviationM36": 6.6, "SharpeM36": 0.41,
        "AlphaM36": -0.7, "BetaM36": 0.95, "R2M36": 88.0, "InformationRatioM36": -0.3,
        "CustomManagementFee": "1.5", "CustomMinimumPurchaseAmount": "30",
    }
    fila.update(cambios)
    return {k: v for k, v in fila.items() if v is not None}


def _epsv(n: int, **cambios) -> dict:
    base = {"Name": f"Previsión {n:03d} EPSV", "LegalName": f"Previsión {n:03d}, EPSV Individual", "DGSCode": None}
    return _fila(n, **{**base, **cambios})


SERIE = [[_ms("2026-08-28"), 10.0], [_ms("2026-08-31"), 10.1], [_ms("2026-09-15"), 10.2],
         [_ms("2026-09-30"), 10.3], [_ms("2026-10-30"), 10.4], [_ms("2026-11-10"), 10.5]]


class _Resp:
    def __init__(self, status, payload):
        self.status, self.text = status, json.dumps(payload)
        self.fetched_at = dt.datetime(2026, 11, 13, 9, 0, tzinfo=dt.timezone.utc).timestamp()

    @property
    def ok(self):
        return 200 <= self.status < 300

    def json(self):
        return json.loads(self.text)


class _Http:
    """El buscador devuelve `filas` paginadas; la serie, `series[SecId]` o un 404."""

    def __init__(self, filas, series=None, *, total=None, sin_red=False, pagina_rota=None, serie_caida=()):
        self.filas, self.series, self.total = filas, series or {}, len(filas) if total is None else total
        self.sin_red, self.pagina_rota, self.serie_caida = sin_red, pagina_rota, set(serie_caida)
        self.pedidas: list[tuple[str, dict]] = []

    def get(self, url, params=None, **_kw):
        self.pedidas.append((url, dict(params or {})))
        if self.sin_red:
            raise SinCache(f"sin caché y sin red: {url}")
        if url == morningstar_planes.BUSCADOR:
            pagina, tamano = params["page"], params["pageSize"]
            if pagina == self.pagina_rota:
                return _Resp(503, {})
            return _Resp(200, {"total": self.total, "page": pagina, "pageSize": tamano,
                               "rows": self.filas[(pagina - 1) * tamano: pagina * tamano]})
        if url == morningstar_planes.SERIE:
            if params["id"] in self.serie_caida:
                raise ConnectionError("agotados los reintentos")
            if params["id"] in self.series:
                return _Resp(200, self.series[params["id"]])
            return _Resp(404, {})
        raise AssertionError(f"petición que no se esperaba: {url}")


# ---------------------------------------------------------------- plan o EPSV

def test_un_producto_con_codigo_de_la_dgsfp_es_un_plan_de_pensiones():
    tipo, motivo = planes.tipo_de(_fila(1981))
    assert tipo == planes.PLAN
    assert "N1981" in motivo


def test_sin_codigo_y_con_epsv_en_el_nombre_es_una_epsv():
    assert planes.tipo_de(_epsv(7))[0] == planes.EPSV
    # Basta con que lo diga el nombre legal.
    assert planes.tipo_de(_epsv(7, Name="Previsión 007"))[0] == planes.EPSV


@pytest.mark.parametrize("fila, trozo", [
    (_fila(5, Name="Plan 005 EPSV"), "también código"),
    (_fila(5, DGSCode=None), "sin «EPSV»"),
    (_fila(5, DGSCode="12345"), "no tiene forma"),
])
def test_si_las_dos_senales_no_coinciden_no_se_adivina(fila, trozo):
    tipo, motivo = planes.tipo_de(fila)
    assert tipo is None
    assert trozo in motivo


def test_lo_que_no_se_clasifica_no_entra_y_se_nombra():
    salida = planes.compone([_fila(1), _fila(2, DGSCode=None), _epsv(3)], {}, total_declarado=3, consultado=None)
    assert [p["id"] for p in salida["planes"]] == ["F0GBR00001", "F0GBR00003"]
    assert [x["id"] for x in salida["sin_clasificar"]] == ["F0GBR00002"]
    assert salida["cuentas"]["planes_de_pensiones"] == 1
    assert salida["cuentas"]["epsv"] == 1
    assert salida["cuentas"]["sin_clasificar"] == 1


def test_un_plan_de_empleo_simplificado_es_un_plan_de_pensiones_y_lo_dice():
    ficha = planes.ficha_de(_fila(9, Name="Gestora Empleo PPES"), planes.PLAN, [])
    assert ficha["tipo"] == planes.PLAN
    assert ficha["empleo_simplificado"] is True
    assert "empleo_simplificado" not in planes.ficha_de(_fila(9), planes.PLAN, [])


# ------------------------------------------------------------------ las cifras

def test_las_cifras_son_las_de_la_fuente_con_los_nombres_de_aqui():
    ficha = planes.ficha_de(_fila(1981), planes.PLAN, [])
    assert ficha["codigo_dgsfp"] == "N1981"
    assert ficha["gestora"] == "Gestora de Prueba"
    assert ficha["estrellas"] == 3
    assert ficha["estrellas_fecha"] == "2026-10-31"
    assert ficha["inversion_minima"] == 30
    assert ficha["fecha_inicio"] == "2001-05-07"
    assert ficha["valor_participacion"] == {"valor": 12.3456, "fecha": "2026-11-10"}
    assert ficha["rentabilidad"] == {"m1": 0.5, "m6": 2.1, "ytd": 4.2, "a1": 6.3, "a3": 3.03, "a5": 2.2, "a10": 1.9}
    assert ficha["volatilidad"] == {"a1": 5.5, "a3": 6.6}
    assert ficha["ratios"] == {"sharpe_a3": 0.41, "alfa_a3": -0.7, "beta_a3": 0.95, "r2_a3": 88.0, "informacion_a3": -0.3}
    # La comisión de gestión la pone el banco y llega como texto.
    assert ficha["comisiones"] == {"gestion": 1.5}


def test_las_rentabilidades_llevan_su_propia_fecha_que_no_es_la_del_valor():
    """Medido el 13-11-2026: en 4 de los 220 las rentabilidades iban meses por detrás del valor."""
    ficha = planes.ficha_de(_fila(1, TrailingDate="2026-03-16T00:00:00"), planes.PLAN, [])
    assert ficha["rentabilidad_fecha"] == "2026-03-16"
    assert ficha["valor_participacion"]["fecha"] == "2026-11-10"
    sin_cifras = {k: None for k in ("ReturnM1", "ReturnM6", "ReturnM0", "ReturnM12", "ReturnM36", "ReturnM60", "ReturnM120")}
    assert "rentabilidad_fecha" not in planes.ficha_de(_fila(1, **sin_cifras), planes.PLAN, [])
    # Una fecha de estrellas sin estrellas no dice nada.
    assert "estrellas_fecha" not in planes.ficha_de(_fila(1, StarRatingM255=None), planes.PLAN, [])


def test_lo_que_la_fuente_no_da_no_aparece_ni_como_cero_ni_como_nulo():
    fila = _epsv(4, StarRatingM255=None, ReturnM120=None, ReturnM60="", AlphaM36=None, BetaM36=None, R2M36=None,
                 InformationRatioM36=None, SharpeM36=None, CustomManagementFee=None, CategoryName=None)
    ficha = planes.ficha_de(fila, planes.EPSV, [])
    assert "estrellas" not in ficha and "categoria" not in ficha and "codigo_dgsfp" not in ficha
    assert "a10" not in ficha["rentabilidad"] and "a5" not in ficha["rentabilidad"]
    assert "ratios" not in ficha and "comisiones" not in ficha

    def sin_nulos(valor):
        if isinstance(valor, dict):
            return all(sin_nulos(v) for v in valor.values())
        if isinstance(valor, list):
            return all(sin_nulos(v) for v in valor)
        return valor is not None

    assert sin_nulos(ficha)


def test_un_cero_de_la_fuente_es_un_cero_y_no_una_ausencia():
    ficha = planes.ficha_de(_fila(6, ReturnM1=0, ReturnM0=0.0), planes.PLAN, [])
    assert ficha["rentabilidad"]["m1"] == 0
    assert ficha["rentabilidad"]["ytd"] == 0


def test_no_se_pide_lo_que_se_decidio_no_ensenar():
    """D3 deja fuera el percentil en la categoría; lo demás, lo medido el 13-11-2026 (ver el fetcher)."""
    pedidos = morningstar_planes.CAMPOS.split("|")
    assert not [c for c in pedidos if c.startswith("CatRank") or "Medalist" in c]
    for fuera in ("OngoingCharge", "ManagementFee", "SRRI"):
        assert fuera not in pedidos
    assert "CustomManagementFee" in pedidos and "TrailingDate" in pedidos


# -------------------------------------------------------------------- la serie

def test_la_serie_se_reduce_al_ultimo_valor_de_cada_mes_y_conserva_el_ultimo_punto():
    serie = morningstar_planes.morningstar_series.lee(SERIE)
    assert planes.mensual(serie) == [["2026-08-31", 10.1], ["2026-09-30", 10.3], ["2026-10-30", 10.4], ["2026-11-10", 10.5]]
    ficha = planes.ficha_de(_fila(1), planes.PLAN, serie)
    assert ficha["serie"] == {"desde": "2026-08-28", "hasta": "2026-11-10", "puntos_diarios": 6}
    assert ficha["serie_mensual"][-1] == ["2026-11-10", 10.5]


# ------------------------------------------------------------------- la pasada

def test_la_lista_se_pide_por_paginas_hasta_el_total(tmp_path):
    filas = [_fila(n) for n in range(1, 203)] + [_epsv(n) for n in range(203, 221)]
    http = _Http(filas)
    recibidas, total, consultado = morningstar_planes.lista(http)
    assert (len(recibidas), total) == (220, 220)
    assert consultado is not None
    assert [p["page"] for _url, p in http.pedidas] == [1, 2, 3]
    assert all(p["universeIds"] == "FOESP$$PEN_4200" for _url, p in http.pedidas)


def test_la_pasada_escribe_el_catalogo_con_plan_y_epsv_marcados(tmp_path):
    filas = [_fila(n) for n in range(1, 203)] + [_epsv(n) for n in range(203, 221)]
    http = _Http(filas, {f["SecId"]: SERIE for f in filas})
    salida = planes.pasada(tmp_path, http, hoy="2026-11-13")
    c = salida["cuentas"]
    assert (c["planes"], c["planes_de_pensiones"], c["epsv"]) == (220, 202, 18)
    assert (c["con_serie"], c["sin_serie"], c["sin_clasificar"]) == (220, 0, 0)
    escrito = json.loads((tmp_path / planes.RUTA_SALIDA).read_text(encoding="utf-8"))
    assert escrito["schema_version"] == "fondosdb.planes.v1"
    assert escrito["generado"] == "2026-11-13"
    assert escrito["fuente"]["consultado"] == "2026-11-13T09:00:00+00:00"
    assert {p["tipo"] for p in escrito["planes"]} == {"PLAN_DE_PENSIONES", "EPSV"}
    assert len({p["id"] for p in escrito["planes"]}) == 220


def test_una_serie_que_no_llega_no_tumba_la_pasada_y_se_dice(tmp_path):
    filas = [_fila(1), _fila(2), _epsv(3)]
    http = _Http(filas, {"F0GBR00001": SERIE}, serie_caida={"F0GBR00002"})
    salida = planes.pasada(tmp_path, http, hoy="2026-11-13")
    assert salida["cuentas"]["planes"] == 3
    assert salida["cuentas"]["con_serie"] == 1
    motivos = {x["id"]: x["motivo"] for x in salida["sin_serie"]}
    assert "no contesta" in motivos["F0GBR00002"]
    assert motivos["F0GBR00003"] == "la fuente no da serie"
    assert "serie_mensual" not in next(p for p in salida["planes"] if p["id"] == "F0GBR00002")


def test_si_no_llega_ninguna_serie_el_catalogo_que_hay_no_se_sobrescribe(tmp_path):
    """EXT-12: la fuente de las series deja de contestar. Antes se escribía el catálogo entero sin gráfico."""
    filas = [_fila(1), _fila(2), _epsv(3)]
    planes.pasada(tmp_path, _Http(filas, {f["SecId"]: SERIE for f in filas}), hoy="2026-11-13")
    bueno = (tmp_path / planes.RUTA_SALIDA).read_text(encoding="utf-8")
    assert planes.con_serie_en_el_fichero(tmp_path) == 3
    # Dos maneras de no llegar: la red se cae, o la fuente contesta que no (un 404, o un 401 a todo).
    for caida in (_Http(filas, {}, serie_caida={f["SecId"] for f in filas}), _Http(filas, {})):
        with pytest.raises(ConnectionError, match="ninguna de las 3 series"):
            planes.pasada(tmp_path, caida, hoy="2026-11-14")
        assert (tmp_path / planes.RUTA_SALIDA).read_text(encoding="utf-8") == bueno
    # Con una sola que llegue ya no es la fuente caída: se escribe, y dice cuáles faltan.
    salida = planes.pasada(tmp_path, _Http(filas, {"F0GBR00001": SERIE}), hoy="2026-11-14")
    assert (salida["cuentas"]["con_serie"], salida["cuentas"]["sin_serie"]) == (1, 2)
    assert planes.con_serie_en_el_fichero(tmp_path) == 1


def test_la_primera_pasada_sin_ninguna_serie_si_escribe(tmp_path):
    """Sin un catálogo anterior con series no hay nada que proteger: un catálogo sin gráficos es mejor que ninguno."""
    assert planes.con_serie_en_el_fichero(tmp_path) == 0
    salida = planes.pasada(tmp_path, _Http([_fila(1), _epsv(2)], {}), hoy="2026-11-13")
    assert salida["cuentas"]["con_serie"] == 0
    assert (tmp_path / planes.RUTA_SALIDA).exists()


def test_no_se_pide_la_serie_de_lo_que_no_entra(tmp_path):
    http = _Http([_fila(1), _fila(2, DGSCode=None)], {})
    planes.pasada(tmp_path, http, hoy="2026-11-13")
    assert [p["id"] for url, p in http.pedidas if url == morningstar_planes.SERIE] == ["F0GBR00001"]


@pytest.mark.parametrize("http", [
    _Http([_fila(n) for n in range(1, 151)], pagina_rota=2),
    _Http([_fila(n) for n in range(1, 151)], total=220),
    _Http([_fila(1)], sin_red=True),
])
def test_una_lista_a_medias_no_escribe_un_catalogo(tmp_path, http):
    with pytest.raises(ConnectionError):
        planes.pasada(tmp_path, http, hoy="2026-11-13")
    assert not (tmp_path / planes.RUTA_SALIDA).exists()


def test_sin_series_la_pasada_solo_pide_la_lista(tmp_path):
    http = _Http([_fila(1), _epsv(2)], {"F0GBR00001": SERIE})
    salida = planes.pasada(tmp_path, http, con_series=False, hoy="2026-11-13")
    assert all(url == morningstar_planes.BUSCADOR for url, _p in http.pedidas)
    assert salida["cuentas"]["con_serie"] == 0
    assert {x["motivo"] for x in salida["sin_serie"]} == {"la pasada se lanzó sin series"}
