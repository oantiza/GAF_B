"""Decisión B-74 (Óscar, 09-11-2026): una fecha por cifra en la rentabilidad del proveedor.

El bloque `rentabilidad` mezclaba dos fechas bajo una sola `fecha_dato`: el 1 mes, el año en
curso y el 1 año de `sal trailingReturn` llegan a fin de mes (`fundReturnDate`), y el 3, 5 y 10
años anualizados del snapshot `lt`, a la fecha de su serie `MonthEnd`, que puede ir un mes
detrás. `rentabilidad.fecha_dato_por_ventana` lleva la de cada cifra; `fecha_dato` se queda como
estaba. Los payloads están recortados de `cache/raw_morningstar_lt/LU1295551144/`
(Capital Group New Perspective), guardados el 09-11-2026.
"""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint  # noqa: E402
from core.schema import set_path  # noqa: E402
from fetchers import morningstar as ms  # noqa: E402
from fetchers import morningstar_lt as ms_lt  # noqa: E402

# sal_trailingReturn.json (recortado)
SAL = {
    "columnDefs": ["1Month", "3Month", "YearToDate", "1Year", "3Year", "5Year", "10Year",
                   "15Year", "SinceInception"],
    "totalReturnNAV": ["-1.59296", "1.65395", "8.05782", "6.32612", "54.02786", "31.5114",
                       "194.22395", None, None],
    "fundReturnDate": "2026-10-31T05:00:00.000",
    "categoryDate": "2026-10-31T05:00:00.000",
}

# ETFsnapshot.json (recortado): la serie MonthEnd del fondo está a 30-09.
SNAPSHOT = {
    "TrailingPerformance": [
        {"Date": "2026-10-30T00:00:00", "Type": "DayEnd", "Return": [
            {"TimePeriod": "M1", "Value": -1.592964, "Annualized": True,
             "Date": "2026-10-30T00:00:00"}]},
        {"Date": "2026-09-30T00:00:00", "Type": "MonthEnd", "Return": [
            {"TimePeriod": "M0", "Value": 9.807003, "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M1", "Value": 1.701524, "Annualized": True,
             "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M6", "Value": 14.425003, "Annualized": True,
             "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M12", "Value": 12.182196, "Annualized": True,
             "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M36", "Value": 14.768098, "Annualized": True,
             "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M60", "Value": 7.414607, "Annualized": True,
             "Date": "2026-09-30T00:00:00"},
            {"TimePeriod": "M120", "Value": 11.636599, "Annualized": True,
             "Date": "2026-09-30T00:00:00"}]},
    ],
}

# screener.json (recortado): rentabilidades sin fecha propia.
SCREENER = {"ClosePriceDate": "2026-11-06", "ReturnM1": -5.42, "ReturnM6": 1.22,
            "ReturnM36": 13.64}


def _fechas(out):
    return out.get("rentabilidad", {}).get("fecha_dato_por_ventana")


def _como_lt(screener=None, snapshot=None, sal=None):
    """Los tres bloques en el orden de `morningstar_lt.fetch`, con su procedencia."""
    out = {}
    with procedencia.activa("morningstar_lt") as reg:
        if screener is not None:
            with procedencia.etapa("screener"):
                ms_lt._mapea_screener(out, screener)
        if snapshot is not None:
            with procedencia.etapa("ETFsnapshot"):
                ms_lt._mapea_snapshot(out, snapshot)
        if sal is not None:
            with procedencia.etapa("sal_trailingReturn"):
                ms._mapea(out, {"trailingReturn": sal})
    etiquetas = {ruta: reg.resuelve(ruta) for ruta, _v in procedencia.hojas(out)}
    return out, etiquetas


def test_sal_trailing_return_fecha_de_fund_return_date():
    out = {}
    ms._mapea(out, {"trailingReturn": SAL})
    assert _fechas(out) == {"1m": "2026-10-31", "3m": "2026-10-31", "ytd": "2026-10-31",
                            "1a": "2026-10-31"}
    # `fecha_dato` sigue como estaba: este bloque nunca la escribió (no trae `returnDate`).
    assert "fecha_dato" not in out["rentabilidad"]


def test_snapshot_fecha_de_cada_return():
    out = {}
    ms_lt._mapea_snapshot(out, SNAPSHOT)
    assert _fechas(out) == {"ytd": "2026-09-30", "1m": "2026-09-30", "6m": "2026-09-30",
                            "1a": "2026-09-30", "3a_anualizada": "2026-09-30",
                            "5a_anualizada": "2026-09-30", "10a_anualizada": "2026-09-30"}
    assert out["rentabilidad"]["fecha_dato"] == "2026-09-30"


def test_snapshot_sin_date_en_el_return_usa_la_de_la_serie():
    snap = {"TrailingPerformance": [{"Date": "2026-08-31T00:00:00", "Type": "MonthEnd",
                                     "Return": [{"TimePeriod": "M36", "Value": 5.0,
                                                 "Annualized": True}]}]}
    out = {}
    ms_lt._mapea_snapshot(out, snap)
    assert _fechas(out) == {"3a_anualizada": "2026-08-31"}


def test_screener_escribe_la_cifra_sin_fecha():
    out = {}
    ms_lt._mapea_screener(out, SCREENER)
    assert out["rentabilidad"]["trailing_pct"]["1m"]["fondo"] == -5.42
    assert _fechas(out) is None


def test_dos_fuentes_cada_ventana_lleva_la_suya():
    out, etiquetas = _como_lt(SCREENER, SNAPSHOT, SAL)
    tr = out["rentabilidad"]["trailing_pct"]
    assert _fechas(out) == {
        # de sal trailingReturn, que pisa al snapshot
        "1m": "2026-10-31", "3m": "2026-10-31", "ytd": "2026-10-31", "1a": "2026-10-31",
        # del snapshot: sal no tiene 6 meses, y su >1 año es acumulado y no se mapea
        "6m": "2026-09-30", "3a_anualizada": "2026-09-30", "5a_anualizada": "2026-09-30",
        "10a_anualizada": "2026-09-30"}
    assert tr["1m"]["fondo"] == -1.59296 and tr["3a_anualizada"]["fondo"] == 14.768098
    # la fecha y su cifra salen de la misma respuesta
    for ventana in _fechas(out):
        assert (etiquetas[f"rentabilidad.fecha_dato_por_ventana.{ventana}"]
                == etiquetas[f"rentabilidad.trailing_pct.{ventana}.fondo"])


def test_fecha_dato_no_cambia():
    out, _ = _como_lt(SCREENER, SNAPSHOT, SAL)
    assert out["rentabilidad"]["fecha_dato"] == "2026-09-30"
    solo_snapshot = {}
    ms_lt._mapea_snapshot(solo_snapshot, SNAPSHOT)
    assert solo_snapshot["rentabilidad"]["fecha_dato"] == out["rentabilidad"]["fecha_dato"]


def test_una_cifra_que_pisa_sin_fecha_se_lleva_la_fecha_anterior():
    sin_fecha = {k: v for k, v in SAL.items() if not k.endswith("Date")}
    out, _ = _como_lt(None, SNAPSHOT, sin_fecha)
    fechas = _fechas(out)
    assert "1m" not in fechas and "1a" not in fechas and "ytd" not in fechas
    assert fechas["6m"] == "2026-09-30" and fechas["3a_anualizada"] == "2026-09-30"


def test_fecha_no_iso_no_entra():
    out = {}
    ms.pon_rentabilidad_fondo(out, "1m", 1.0, "31/10/2026")
    assert out["rentabilidad"]["trailing_pct"]["1m"]["fondo"] == 1.0
    assert _fechas(out) is None


# ------------------------------------------------------------------ fusión
def _adaptador(id_, orden, datos, endpoint):
    def fetch(isin, ctx):
        out = {}
        with procedencia.etapa(endpoint):
            for ruta, valor in datos.items():
                set_path(out, ruta, valor)
        return out
    return Adaptador(id=id_, descripcion="", oficial=False,
                     capacidades={r: "rendimiento" for r in datos},
                     endpoints=(Endpoint(endpoint, "rendimiento"),), fetch=fetch, orden=orden)


MS_DATOS = {"rentabilidad.fecha_dato": "2026-09-30",
            "rentabilidad.trailing_pct.1m.fondo": 1.7,
            "rentabilidad.fecha_dato_por_ventana.1m": "2026-10-31",
            "rentabilidad.trailing_pct.3a_anualizada.fondo": 14.8,
            "rentabilidad.fecha_dato_por_ventana.3a_anualizada": "2026-09-30"}


def test_fusion_conserva_las_fechas_de_la_fuente_publicada(tmp_path):
    d = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                        [_adaptador("morningstar_lt", 20, MS_DATOS, "sal_trailingReturn")]).datos
    assert d["rentabilidad"]["fecha_dato_por_ventana"] == {"1m": "2026-10-31",
                                                           "3a_anualizada": "2026-09-30"}
    assert d["rentabilidad"]["fecha_dato"] == "2026-09-30"


def test_fusion_quita_la_fecha_si_la_cifra_es_de_otra_fuente(tmp_path):
    otra = _adaptador("eodhd", 15, {"rentabilidad.trailing_pct.1m.fondo": 2.0}, "eod")
    d = nucleo.adquiere("LU1", "etf", Contexto(http=None, settings={}, base=tmp_path),
                        [otra, _adaptador("morningstar_lt", 20, MS_DATOS, "ETFsnapshot")]).datos
    assert d["rentabilidad"]["trailing_pct"]["1m"]["fondo"] == 2.0
    assert d["rentabilidad"]["fecha_dato_por_ventana"] == {"3a_anualizada": "2026-09-30"}
    assert "rentabilidad.fecha_dato_por_ventana.1m" not in d["meta"]["procedencia"]


def test_la_serie_propia_desplaza_la_fecha_con_su_cifra(tmp_path):
    vl = _adaptador("vl_eodhd", 27, {"rentabilidad.fecha_dato": "2026-10-31",
                                     "rentabilidad.trailing_pct.1m.fondo": 1.6}, "eod")
    d = nucleo.adquiere("LU1", "fondo", Contexto(http=None, settings={}, base=tmp_path),
                        [_adaptador("morningstar_lt", 20, MS_DATOS, "ETFsnapshot"), vl]).datos
    assert "fecha_dato_por_ventana" not in d["rentabilidad"]
    contraste = d["meta"]["contraste"]
    assert contraste["rentabilidad.fecha_dato_por_ventana.3a_anualizada"]["valor"] == "2026-09-30"
    assert contraste["rentabilidad.trailing_pct.3a_anualizada.fondo"]["valor"] == 14.8
