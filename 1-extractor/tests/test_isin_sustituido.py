# -*- coding: utf-8 -*-
"""Un ISIN sustituido por otro no queda como que cotiza.

Decisión 1 de `DECISIONES_DATOS_2026-11-07.md`. Aena cambió de ISIN, `ES0105046009` →
`ES0105046017`, y el universo tenía los dos, los dos «cotiza». El viejo lo era porque una
corrección del 17-10 le fijaba el símbolo `AENA.MC`, que EODHD da con el ISIN nuevo, mientras
su búsqueda por el viejo contesta `[]`. FIRDS conoce el nuevo y no el viejo.

La prueba que más importa es la segunda: Árima y Prisa también salen en EODHD con un ISIN
que no es el suyo, y cotizan. Lo que las separa de Aena es FIRDS, que conoce los dos.
"""
import datetime as dt
import json
import sys
import types
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import disponibilidad, procedencia  # noqa: E402
from core.adquisicion.nucleo import _marca_disponibilidad  # noqa: E402
from fetchers import eodhd, esma_firds  # noqa: E402

VIEJO, NUEVO = "ES0105046009", "ES0105046017"
ARIMA, ARIMA_EN_EODHD = "ES0105376059", "ES0105376000"


def _indice(base: Path, isins: list[str], completo: str | None = "2026-10-31") -> None:
    ruta = base / esma_firds.RUTA_INDICE
    ruta.parent.mkdir(parents=True, exist_ok=True)
    con = esma_firds.abre(ruta)
    for i in isins:
        con.execute("INSERT INTO instrumentos VALUES (?,?,?,?,?,?,?,?,?)",
                    (i, "X", "X", "ESVUFB", "ACCION", "EUR", "959800R7QMXKF0NFMT29", "ES", "2026-10-31"))
    if completo:
        con.execute("INSERT INTO meta VALUES ('completo', ?)", (completo,))
    con.commit()
    con.close()


# ---------------------------------------------------------------- quién es sucesor
def test_aena_el_listado_es_del_nuevo_y_firds_solo_conoce_el_nuevo(tmp_path):
    _indice(tmp_path, [NUEVO])
    assert eodhd.sucesor_de(VIEJO, NUEVO, tmp_path) == NUEVO


def test_arima_un_isin_mal_puesto_en_eodhd_no_es_una_sustitucion(tmp_path):
    """FIRDS conoce los dos: el ISIN del universo es vigente, y Árima cotiza."""
    _indice(tmp_path, [ARIMA, ARIMA_EN_EODHD])
    assert eodhd.sucesor_de(ARIMA, ARIMA_EN_EODHD, tmp_path) is None


def test_sin_indice_firds_no_se_afirma_nada(tmp_path):
    assert eodhd.sucesor_de(VIEJO, NUEVO, tmp_path) is None
    # Y no crea un índice vacío donde no lo había.
    assert not (tmp_path / esma_firds.RUTA_INDICE).exists()


def test_un_indice_sin_completo_cargado_tampoco_prueba_nada(tmp_path):
    _indice(tmp_path, [NUEVO], completo=None)
    assert eodhd.sucesor_de(VIEJO, NUEVO, tmp_path) is None


@pytest.mark.parametrize("otro", [None, "", VIEJO, VIEJO.lower()])
def test_sin_otro_isin_no_hay_sucesor(tmp_path, otro):
    _indice(tmp_path, [NUEVO])
    assert eodhd.sucesor_de(VIEJO, otro, tmp_path) is None


def test_si_firds_no_conoce_ninguno_no_hay_sucesor(tmp_path):
    """Una acción de fuera de la UE: FIRDS no la tiene, y eso no dice nada de su ISIN."""
    _indice(tmp_path, ["DE0007164600"])
    assert eodhd.sucesor_de("US0378331005", "US0378331099", tmp_path) is None


# ---------------------------------------------------------------- el adaptador avisa
class _Resp:
    def __init__(self, status, payload):
        self.status, self.text = status, json.dumps(payload)
        self.fetched_at = dt.datetime(2026, 11, 7, tzinfo=dt.timezone.utc).timestamp()

    @property
    def ok(self):
        return 200 <= self.status < 300

    def json(self):
        return json.loads(self.text)


class _Http:
    sin_red = False

    def __init__(self, rutas):
        self.rutas = rutas

    def get(self, url, params=None, **_kw):
        for sufijo, (status, payload) in self.rutas.items():
            if url.endswith(sufijo):
                return _Resp(status, payload)
        return _Resp(404, [])


def _eod():
    d, out = dt.date(2026, 9, 1), []
    while d <= dt.date(2026, 11, 6):
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "close": 20.0, "adjusted_close": 20.0})
        d += dt.timedelta(days=1)
    return out


RUTAS_AENA = {
    f"/search/{VIEJO}": (200, []),
    "/search/AENA": (200, [{"Code": "AENA", "Exchange": "MC", "Name": "Aena SA", "Type": "Common Stock",
                            "Country": "Spain", "Currency": "EUR", "ISIN": NUEVO}]),
    "/eod/AENA.MC": (200, _eod()),
}


@pytest.fixture
def _sin_red_externa(monkeypatch):
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", [{"date": dt.date(a, m, 1), "value_pct": 2.0}
                                               for a in range(2024, 2027) for m in range(1, 13)])
    monkeypatch.setattr(eodhd, "_token", lambda _base: "demo")
    monkeypatch.setattr(eodhd, "_fundamentals_yahoo", lambda *_a, **_k: False)
    monkeypatch.setattr(eodhd, "_aplica_referencia", lambda *_a, **_k: None)


def test_el_adaptador_conserva_el_precio_y_avisa_del_sucesor(tmp_path, _sin_red_externa):
    _indice(tmp_path, [NUEVO])
    with procedencia.activa("eodhd") as reg:
        out = eodhd.fetch(VIEJO, _Http(RUTAS_AENA), {"divisa": "EUR"}, tipo="accion",
                          base=tmp_path, simbolo_eodhd="AENA.MC")
    assert reg.sucesor == NUEVO
    assert out["valoracion"]["vl_fecha"] == "2026-11-06"


def test_con_su_isin_vigente_en_firds_el_adaptador_no_avisa(tmp_path, _sin_red_externa):
    _indice(tmp_path, [VIEJO, NUEVO])
    with procedencia.activa("eodhd") as reg:
        eodhd.fetch(VIEJO, _Http(RUTAS_AENA), {"divisa": "EUR"}, tipo="accion",
                    base=tmp_path, simbolo_eodhd="AENA.MC")
    assert reg.sucesor is None


# ---------------------------------------------------------------- la marca
def _marca(sucesores, previo=None):
    final = {"meta": {}}
    ctx = types.SimpleNamespace(base=RAIZ)  # el alcance de verdad: España está dentro
    anterior = {"meta": {"disponibilidad": previo}} if previo else None
    _marca_disponibilidad(final, VIEJO, "accion", ctx, {"eodhd": True},
                          {"eodhd": {"valoracion": {"vl": 20.0}}}, anterior, sucesores=sucesores)
    return final["meta"].get("disponibilidad")


@pytest.fixture
def _sin_fecha_del_sucesor(monkeypatch):
    monkeypatch.setattr(esma_firds, "primera_negociacion", lambda _base, _isin: None)


@pytest.fixture
def _sucesor_desde_xmad(monkeypatch):
    monkeypatch.setattr(esma_firds, "primera_negociacion",
                        lambda _base, isin: ("2025-06-19", ["DMAD", "XMAD"]) if isin == NUEVO else None)


def test_un_isin_sustituido_no_queda_como_que_cotiza(_sucesor_desde_xmad):
    previo = {"estado": disponibilidad.COTIZA, "desde": "2026-11-02", "visto": "2026-11-05"}
    marca = _marca({"eodhd": NUEVO}, previo)
    assert marca["estado"] == disponibilidad.DEJO_DE_COTIZAR
    assert marca["estado"] != disponibilidad.COTIZA
    assert NUEVO in marca["detalle"]


def test_deja_de_cotizar_el_dia_de_la_primera_negociacion_del_sucesor(_sucesor_desde_xmad):
    """Decisión 15: Aena 009 deja de cotizar el 19-06-2025, no el día que se vio."""
    marca = _marca({"eodhd": NUEVO})
    assert marca["desde"] == "2025-06-19"
    assert marca["visto"] == dt.date.today().isoformat()
    assert "2025-06-19" in marca["detalle"] and "en DMAD y XMAD según FIRDS" in marca["detalle"]


def test_la_fecha_del_hecho_corrige_la_de_la_observacion_ya_escrita(_sucesor_desde_xmad):
    """La ficha de Aena 009 llevaba desde el 07-11-2026, que era el día en que se vio."""
    previo = {"estado": disponibilidad.DEJO_DE_COTIZAR, "desde": "2026-11-07", "visto": "2026-11-07"}
    assert _marca({"eodhd": NUEVO}, previo)["desde"] == "2025-06-19"


def test_sin_fecha_en_firds_se_conserva_la_observacion_y_se_dice(_sin_fecha_del_sucesor):
    marca = _marca({"eodhd": NUEVO})
    assert marca["estado"] == disponibilidad.DEJO_DE_COTIZAR
    assert marca["desde"] == dt.date.today().isoformat()
    assert "fecha es la de la observación" in marca["detalle"]


def test_sin_fecha_en_firds_la_baja_conserva_su_fecha_en_las_pasadas_siguientes(_sin_fecha_del_sucesor):
    previo = {"estado": disponibilidad.DEJO_DE_COTIZAR, "desde": "2026-11-07", "visto": "2026-11-07"}
    assert _marca({"eodhd": NUEVO}, previo)["desde"] == "2026-11-07"


# ---------------------------------------------------------------- la fecha del sucesor
def _mercados(base: Path, filas: list[tuple]) -> None:
    con = esma_firds.abre(base / esma_firds.RUTA_INDICE)
    for isin, mic, admision, primera in filas:
        con.execute("INSERT INTO mercados VALUES (?,?,?,?,?,?,?)",
                    (isin, mic, admision, admision, primera, None, "2026-10-31"))
    con.commit()
    con.close()


def test_la_primera_negociacion_es_la_de_los_centros_con_admision(tmp_path):
    """El caso real medido el 07-11: MTAH dice 2023-11-15 sin admisión, y no cuenta."""
    _indice(tmp_path, [NUEVO])
    _mercados(tmp_path, [(NUEVO, "MTAH", None, "2023-11-15"),
                         (NUEVO, "BEUP", None, "2025-06-19"),
                         (NUEVO, "XMAD", "2025-06-19", "2025-06-19"),
                         (NUEVO, "DMAD", "2025-06-19", "2025-06-19"),
                         (NUEVO, "XETB", None, "2025-09-05")])
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) == ("2025-06-19", ["DMAD", "XMAD"])


def test_entre_varios_centros_con_admision_gana_el_mas_antiguo(tmp_path):
    _indice(tmp_path, [NUEVO])
    _mercados(tmp_path, [(NUEVO, "XMAD", "2025-06-19", "2025-06-20"),
                         (NUEVO, "XPAR", "2025-06-18", "2025-06-18")])
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) == ("2025-06-18", ["XPAR"])


def test_el_1900_de_francfort_no_es_una_primera_negociacion(tmp_path):
    _indice(tmp_path, [NUEVO])
    _mercados(tmp_path, [(NUEVO, "FRAA", "1899-12-31", "1900-01-01"),
                         (NUEVO, "XETA", "1899-12-31", "1999-08-30")])
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) == ("1999-08-30", ["XETA"])


def test_sin_centro_con_admision_no_hay_fecha(tmp_path):
    _indice(tmp_path, [NUEVO])
    _mercados(tmp_path, [(NUEVO, "MTAH", None, "2023-11-15")])
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) is None


def test_sin_indice_o_sin_isin_no_hay_fecha(tmp_path):
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) is None
    assert not (tmp_path / esma_firds.RUTA_INDICE).exists()
    _indice(tmp_path, [NUEVO])
    assert esma_firds.primera_negociacion(tmp_path, VIEJO) is None


def test_un_indice_sin_completo_no_da_fecha(tmp_path):
    _indice(tmp_path, [NUEVO], completo=None)
    _mercados(tmp_path, [(NUEVO, "XMAD", "2025-06-19", "2025-06-19")])
    assert esma_firds.primera_negociacion(tmp_path, NUEVO) is None


def test_el_aviso_de_otra_fuente_no_cuenta():
    """Solo la fuente que prueba la cotización puede decir que el listado es de otro."""
    assert _marca({"justetf": NUEVO})["estado"] == disponibilidad.COTIZA


def test_sin_sucesor_todo_sigue_igual():
    assert _marca({})["estado"] == disponibilidad.COTIZA
    assert _marca(None)["estado"] == disponibilidad.COTIZA
