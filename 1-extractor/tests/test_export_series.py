import json
from datetime import date

from core import export_series
from core.http import SinCache


class _Respuesta:
    ok = True
    fetched_at = 1_700_000_000.0

    def __init__(self, crudo):
        self._crudo = crudo

    def json(self):
        return self._crudo


class _Http:
    def __init__(self, crudo=None, error=None):
        self.crudo, self.error = crudo, error

    def get(self, *_args, **_kwargs):
        if self.error:
            raise self.error
        return _Respuesta(self.crudo)


def _fila(listado, **traza):
    return {
        "_id": "BE0943877671",
        "valoracion": {"vl_divisa": "EUR"},
        "riesgo": {"historial_precios": {"source_listing_id": listado, **traza}},
    }


def test_un_fondo_exporta_su_valor_liquidativo_y_declara_su_clase(tmp_path):
    """Decisión 72: `close`, aunque el proveedor traiga un ajustado distinto. Un punto sin `close` no es un valor liquidativo."""
    crudo = [
        {"date": "2026-10-29", "adjusted_close": 78.5, "close": 80},
        {"date": "2026-10-30", "close": 79.03},
        {"date": "2026-10-31", "adjusted_close": 79.5},
    ]
    resultado = export_series.exporta_fila(
        _fila("EODHD:BE0943877671.EUFUND", observations_count=2, first_date="2026-10-29", last_date="2026-10-30"),
        _Http(crudo), "t", tmp_path,
    )
    assert resultado == {"isin": "BE0943877671", "estado": "exportada", "observaciones": 2, "diferencias": []}
    documento = json.loads((tmp_path / "BE0943877671.json").read_text(encoding="utf-8"))
    assert documento["price_class"] == "NAV"
    assert documento["currency"] == "EUR"
    assert documento["points"] == [["2026-10-29", 80.0], ["2026-10-30", 79.03]]


def test_lo_que_cotiza_sigue_siendo_el_cierre_ajustado(tmp_path):
    """Una acción o un ETF lleva sus dividendos en el ajustado, y sin ajustado cae a `close`."""
    crudo = [
        {"date": "2026-10-29", "adjusted_close": 78.5, "close": 80},
        {"date": "2026-10-30", "close": 79.03},
    ]
    resultado = export_series.exporta_fila(
        _fila("EODHD:DBK.XETRA", observations_count=2, first_date="2026-10-29", last_date="2026-10-30"),
        _Http(crudo), "t", tmp_path,
    )
    assert resultado["estado"] == "exportada"
    documento = json.loads((tmp_path / "BE0943877671.json").read_text(encoding="utf-8"))
    assert documento["price_class"] == "MARKET_PRICE"
    assert documento["points"] == [["2026-10-29", 78.5], ["2026-10-30", 79.03]]


def test_una_ficha_de_otra_pasada_se_anota(tmp_path):
    resultado = export_series.exporta_fila(
        _fila("EODHD:DBK.XETRA", observations_count=9, last_date="2026-10-01"),
        _Http([{"date": "2026-10-30", "close": 10}]), "t", tmp_path,
    )
    assert resultado["estado"] == "exportada"
    assert resultado["diferencias"] == [
        "observations_count: ficha 9, serie 1",
        "last_date: ficha 2026-10-01, serie 2026-10-30",
    ]


def test_lo_que_no_se_puede_exportar_se_declara_y_no_escribe(tmp_path):
    casos = [
        (_fila("YAHOO:DIGIS.MC"), _Http([]), "fuente_no_exportable"),
        (_fila(None), _Http([]), "sin_traza"),
        (_fila("EODHD:X.XETRA"), _Http(error=SinCache("no")), "sin_cache"),
        (_fila("EODHD:X.XETRA"), _Http([]), "serie_vacia"),
    ]
    for fila, http, estado in casos:
        assert export_series.exporta_fila(fila, http, "t", tmp_path)["estado"] == estado
    assert list(tmp_path.iterdir()) == []


def test_clase_de_precio():
    assert export_series.clase_de_precio("LU0000000000.EUFUND") == "NAV"
    assert export_series.clase_de_precio("SXR8.XETRA") == "MARKET_PRICE"


def test_compara_traza_sin_declarar_no_inventa_diferencias():
    assert export_series.compara_traza({}, [(date(2026, 10, 30), 1.0)]) == []


def test_los_cambios_del_bce_ignoran_los_huecos_y_se_ordenan():
    texto = "TIME_PERIOD,OBS_VALUE\n2026-01-05,1.2\n2026-01-02,1.1\n2026-01-01,\n2026-01-06,NaN\n"
    puntos = export_series.lee_cambios_bce(texto)
    assert puntos[:2] == [["2026-01-02", 1.1], ["2026-01-05", 1.2]]


def test_los_peniques_piden_la_libra(tmp_path):
    (tmp_path / "A.json").write_text(json.dumps({"currency": "GBX"}), encoding="utf-8")
    (tmp_path / "B.json").write_text(json.dumps({"currency": "EUR"}), encoding="utf-8")
    (tmp_path / "C.json").write_text(json.dumps({"currency": "USD"}), encoding="utf-8")
    assert export_series.monedas_necesarias(tmp_path) == {"GBP", "USD"}


def test_la_estr_pasa_a_fraccion_y_admite_negativos():
    texto = "TIME_PERIOD,OBS_VALUE\n2021-01-05,-0.56\n2026-01-02,1.93\n2026-01-01,\n2026-01-06,NaN\n2026-01-07,99\n"
    assert export_series.lee_estr_bce(texto) == [["2021-01-05", -0.0056], ["2026-01-02", 0.0193]]



def test_la_divisa_de_un_etf_es_la_de_su_cotizacion_y_no_la_de_su_clase():
    from core.export_series import _divisa

    def fila(**historial):
        return {"valoracion": {"vl_divisa": "USD"}, "identificacion": {"divisa_base": "USD"},
                "riesgo": {"historial_precios": {"clase_de_serie": "PRECIO_DE_MERCADO",
                                                 "divisa_metricas": "EUR", **historial}}}

    assert _divisa(fila()) == "EUR"
    assert _divisa(fila(divisa_origen="USD")) == "USD"
    # Un fondo sigue como estaba.
    assert _divisa({"valoracion": {"vl_divisa": "USD"}}) == "USD"
