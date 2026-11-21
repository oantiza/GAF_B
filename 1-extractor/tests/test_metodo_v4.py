# -*- coding: utf-8 -*-
"""La versión 4 del método (MET-6 y MET-7 de la auditoría integral, 17-11-2026).

- MET-7: un cierre de mes tiene que ser del final del mes (`es_cierre_de_mes`), en el riesgo, en las
  relativas y en los diciembres del año natural; y el año natural aplica la regla del hueco.
- MET-6: las relativas cierran en el mes del riesgo del fondo, o no se dan.

Cada cifra esperada sale de una cuenta a mano escrita junto a su prueba, nunca de la salida del código.
Los días de la semana de cada fecha están comprobados en el calendario y escritos al lado.
"""
import json
import math
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402
from core.adquisicion import procedencia  # noqa: E402
from fetchers import eodhd, vl_fondos  # noqa: E402


def _ultimo_laborable(ano: int, mes: int) -> date:
    d = m.ultimo_dia(date(ano, mes, 1))
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _meses(desde: tuple[int, int], n: int) -> list[tuple[int, int]]:
    ano, mes = desde
    out = []
    for _ in range(n):
        out.append((ano, mes))
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    return out


#: De octubre de 2025 a octubre de 2026: 13 cierres, 12 rentabilidades, la ventana de un año.
MESES = _meses((2025, 10), 13)

#: Valores que alternan +10 % y −10 %: 100, 110, 99, 108,9… Las 12 rentabilidades son seis de +0,1
#: y seis de −0,1, de media 0, y su desviación típica muestral es √(12 × 0,01 / 11) = 0,1 × √(12/11).
#: Anualizada por √12: 0,1 × 12 / √11 = 1,2 / 3,31662479… = 0,36181361… → 36,1814 %.
VOL_ALTERNA = 36.1814


def _alterna(n: int, salto: float = 0.10) -> list[float]:
    valores, v = [], 100.0
    for i in range(n):
        valores.append(v)
        v *= 1 + salto if i % 2 == 0 else 1 - salto
    return valores


def _serie_de_cierres(cierres: dict[tuple[int, int], date] | None = None, salto: float = 0.10) -> m.Serie:
    """Cada mes, su cierre en su último laborable —o en la fecha de `cierres`— y otro valor el día 12
    (o el laborable de antes), para que entre dos valores no haya nunca un hueco, tampoco con la regla
    diaria de 31 días. El del día 12 no entra en ninguna cuenta mensual."""
    cierres = cierres or {}
    s = []
    for k, v in zip(MESES, _alterna(len(MESES), salto)):
        cierre = cierres.get(k, _ultimo_laborable(*k))
        medio = date(k[0], k[1], 12)
        while medio.weekday() >= 5:
            medio -= timedelta(days=1)
        if medio < cierre:
            s.append((medio, v))
        s.append((cierre, v))
    return s


# ------------------------------------------------------------------ la versión
def test_la_version_es_la_4_y_viaja_en_el_sello():
    assert m.VERSION_METODO == 4
    assert m.sello_del_metodo("cierre de mes") == "core.metricas v4: cierre de mes"


# ------------------------------------------------------------------ MET-7: qué es un cierre
class TestQueEsUnCierreDeMes:
    def test_la_tolerancia_es_una_semana_laborable(self):
        assert m.CIERRE_LABORABLES_MAX == 5

    @pytest.mark.parametrize("dia,quedan,cierre", [
        # Viernes 30-10-2026; el 31 es sábado: no queda ningún laborable.
        (date(2026, 10, 30), 0, True),
        # Miércoles 27-03-2024: jueves 28 y viernes 29 (Jueves y Viernes Santo); el 30 y el 31, fin de semana.
        (date(2024, 3, 27), 2, True),
        # Viernes 24-01-2025: del lunes 27 al viernes 31, cinco. Es el límite, y es un cierre.
        (date(2025, 1, 24), 5, True),
        # Jueves 23-01-2025: el viernes 24 y del 27 al 31, seis. Ya no.
        (date(2025, 1, 23), 6, False),
        # Miércoles 22-01-2025, el fondo de Taiwán: el 23, el 24 y del 27 al 31, siete.
        (date(2025, 1, 22), 7, False),
        # Lunes 03-05-2021, un «cierre» de mayo del día 3: del 4 al 7 (4), tres semanas de 5 y el lunes 31.
        # 4 + 5 + 5 + 5 + 1 = 20.
        (date(2021, 5, 3), 20, False),
    ])
    def test_cuenta_los_laborables_que_quedan_en_el_mes(self, dia, quedan, cierre):
        assert m.laborables_tras(dia) == quedan
        assert m.es_cierre_de_mes(dia) is cierre

    def test_un_mes_sin_cierre_no_esta_entre_los_fines_de_mes(self):
        """Mayo de 2026 con su último valor el martes 5: del 6 al 8 (3), y del 11 al 29 tres semanas
        de 5; el 30 y el 31 son fin de semana. 3 + 15 = 18 laborables por delante."""
        s = _serie_de_cierres({(2026, 5): date(2026, 5, 5)})
        meses = [(f.year, f.month) for f, _p in m.fin_de_mes(s, incluir_ultimo=True)]
        assert (2026, 5) not in meses and len(meses) == 12


# ------------------------------------------------------------------ MET-7: el riesgo
class TestElRiesgoSinUnCierreNoSePublica:
    def test_con_todos_los_cierres_sale_la_cifra_de_la_cuenta(self):
        """La serie alterna ±10 % y el último valor es del viernes 30-10-2026: la ventana de un año
        es de noviembre de 2025 a octubre de 2026, y su volatilidad es la de la cuenta: 36,1814 %."""
        s = _serie_de_cierres()
        assert m.cierre_mensual(s) == date(2026, 10, 31)
        r = m.riesgo(s, fin=m.cierre_mensual(s))
        assert r["1a"]["volatilidad"] == pytest.approx(VOL_ALTERNA, abs=1e-4)

    def test_un_cierre_del_lunes_25_vale(self):
        """Mayo con el valor del lunes 25: quedan el 26, 27, 28 y 29, cuatro. Es un cierre, y la cifra
        no cambia, porque la cuenta solo mira los valores de cierre: 36,1814 %."""
        s = _serie_de_cierres({(2026, 5): date(2026, 5, 25)})
        assert m.riesgo(s, fin=m.cierre_mensual(s))["1a"]["volatilidad"] == pytest.approx(VOL_ALTERNA, abs=1e-4)

    def test_un_cierre_del_dia_5_tumba_la_ventana_y_la_ficha_lo_dice(self):
        """Mayo con el valor del martes 5 y el siguiente el miércoles 3 de junio, para que no haya un
        hueco de más de 31 días (del 5-5 al 3-6 van 29; del 3-6 al 30-6, 27): hasta la versión 3 la
        ventana se publicaba, con el 5 de mayo haciendo de cierre. Ahora no, y se dice por qué."""
        s = _serie_de_cierres({(2026, 5): date(2026, 5, 5)})
        s = sorted(s + [(date(2026, 6, 3), 104.0)])
        fin = m.cierre_mensual(s)
        assert m.hueco_en_ventana(s, m.resta_meses(fin, 12)) is None   # no lo para la regla del hueco
        assert "1a" not in m.riesgo(s, fin=fin)
        # La serie empieza en octubre de 2025, doce meses antes de `fin`: solo llega a la de un año.
        assert m.meses_sin_cierre(s, fin) == [
            {"mes": "2026-05", "ultimo_dato": "2026-05-05", "laborables_despues": 18, "ventanas": ["1a"]}]

    def test_sin_meses_sin_cierre_no_se_dice_nada(self):
        s = _serie_de_cierres()
        assert m.meses_sin_cierre(s, m.cierre_mensual(s)) == []


# ------------------------------------------------------------------ MET-7: el año natural
class TestElAnoNatural:
    @staticmethod
    def _anual(diciembres: dict[int, date], valores: dict[int, float], hueco: tuple[date, date] | None = None):
        """Un valor de 100 cada laborable de 2023 a 2025, salvo en cada diciembre, que acaba en la fecha
        de `diciembres` con el valor de `valores`. Sin valores dentro de `hueco`."""
        s, d = [], date(2023, 1, 2)
        while d <= date(2025, 12, 31):
            if d.weekday() < 5 and not (hueco and hueco[0] < d < hueco[1]):
                if d.month == 12 and d > diciembres[d.year]:
                    d += timedelta(days=1)
                    continue
                s.append((d, 100.0))
            d += timedelta(days=1)
        fijos = {diciembres[a]: v for a, v in valores.items()}
        return [(f, fijos.get(f, p)) for f, p in s]

    DICIEMBRES = {2023: date(2023, 12, 29), 2024: date(2024, 12, 31), 2025: date(2025, 12, 31)}

    def test_un_ano_con_sus_dos_cierres_sale_la_cuenta(self):
        """Viernes 29-12-2023 = 100, martes 31-12-2024 = 110, miércoles 31-12-2025 = 121.
        2024: 110 / 100 − 1 = 10 %. 2025: 121 / 110 − 1 = 10 %."""
        s = self._anual(self.DICIEMBRES, {2023: 100.0, 2024: 110.0, 2025: 121.0})
        assert m.por_ano_natural(s) == {"2024": pytest.approx(10.0, abs=1e-4), "2025": pytest.approx(10.0, abs=1e-4)}

    def test_un_ano_con_un_hueco_no_se_publica(self):
        """Sin un solo valor del 1 de marzo al 10 de abril de 2024: 40 días, más de 31. 2024 no mide el año
        y no sale; 2025 sigue saliendo con su 10 %. Hasta la versión 3 salían los dos."""
        s = self._anual(self.DICIEMBRES, {2023: 100.0, 2024: 110.0, 2025: 121.0},
                        hueco=(date(2024, 3, 1), date(2024, 4, 10)))
        assert m.hueco_en_ventana(s, date(2023, 12, 29), date(2024, 12, 31)) == (date(2024, 3, 1), date(2024, 4, 10))
        assert m.por_ano_natural(s) == {"2025": pytest.approx(10.0, abs=1e-4)}

    def test_el_diciembre_es_un_cierre_de_mes_como_los_demas(self):
        """El de 2024 en el lunes 23 de diciembre: quedan el 24, 25, 26, 27, 30 y 31, seis laborables.
        Hasta la versión 3 valía (8 días naturales, la tolerancia era de 10). Ahora ni 2024 ni 2025.
        Con el martes 24 quedan cinco, y vale: 110 / 100 − 1 = 10 %."""
        valores = {2023: 100.0, 2024: 110.0, 2025: 121.0}
        s = self._anual({**self.DICIEMBRES, 2024: date(2024, 12, 23)}, valores)
        assert m.por_ano_natural(s) == {}
        s = self._anual({**self.DICIEMBRES, 2024: date(2024, 12, 24)}, valores)
        assert m.por_ano_natural(s) == {"2024": pytest.approx(10.0, abs=1e-4), "2025": pytest.approx(10.0, abs=1e-4)}


# ------------------------------------------------------------------ MET-6: las relativas
#: El fondo se mueve el doble que el índice: +20 % y −20 % cuando el índice hace +10 % y −10 %.
#: cov(fondo, índice) = 2 × var(índice), así que la beta es 2 y la correlación 1 (R² 100 %).
#: La diferencia de rentabilidades es la del índice, y el tracking error, su volatilidad: 36,1814 %.
class TestLasRelativasCierranConElRiesgo:
    def test_cierran_en_el_mes_del_riesgo_y_salen_las_cifras_de_la_cuenta(self):
        fondo, indice = _serie_de_cierres(salto=0.20), _serie_de_cierres()
        fin = m.cierre_mensual(fondo)
        rel = m.relativas(fondo, indice, "TOTAL_RETURN", fin=fin)
        assert rel["fecha"] == "2026-10-31" == m.riesgo(fondo, fin=fin)["fecha"]
        assert rel["1a"]["beta"] == pytest.approx(2.0, abs=1e-4)
        assert rel["1a"]["r2"] == pytest.approx(100.0, abs=1e-4)
        assert rel["1a"]["tracking_error"] == pytest.approx(VOL_ALTERNA, abs=1e-4)

    def test_sin_fin_cerraban_un_mes_antes(self):
        """Lo que hacía la versión 3, que llamaba sin `fin`: el último valor es del viernes 30-10, y el
        mes del último valor se daba por abierto aunque estuviera cerrado. Riesgo a 31-10, beta a 30-09."""
        fondo, indice = _serie_de_cierres(salto=0.20), _serie_de_cierres()
        assert m.relativas(fondo, indice, "TOTAL_RETURN")["fecha"] == "2026-09-30"

    def test_si_el_indice_no_llega_al_cierre_no_se_dan(self):
        """El índice acaba el miércoles 30-09-2026 y el fondo cierra en octubre: no se miden en septiembre."""
        fondo, indice = _serie_de_cierres(salto=0.20), _serie_de_cierres()[:-1]
        assert m.relativas(fondo, indice, "TOTAL_RETURN", fin=m.cierre_mensual(fondo)) == {
            "sin_cierre_comun": "2026-09-30"}

    def test_si_el_indice_no_cierra_el_mes_tampoco(self):
        """El índice llega a octubre, pero su último valor es del jueves 15: quedan once laborables."""
        fondo, indice = _serie_de_cierres(salto=0.20), _serie_de_cierres({(2026, 10): date(2026, 10, 15)})
        assert m.relativas(fondo, indice, "TOTAL_RETURN", fin=m.cierre_mensual(fondo)) == {
            "sin_cierre_comun": "2026-09-30"}


# ------------------------------------------------------------------ MET-6: en el lector de fondos
class _Resp:
    def __init__(self, cuerpo):
        self.ok, self.status = True, 200
        self.fetched_at = datetime(2026, 11, 2, 7, 0).timestamp()
        self.text = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)

    def json(self):
        return json.loads(self.text)


class _Http:
    def __init__(self, serie):
        self.serie = serie

    def get(self, url, params=None, force=False, familia=None, ttl_dias=None):
        if "/eod/" in url:
            return _Resp([{"date": f.isoformat(), "close": p, "adjusted_close": p} for f, p in self.serie])
        if "/search/" in url:
            return _Resp([{"Code": url.rsplit("/", 1)[1], "Exchange": "EUFUND", "Currency": "EUR"}])
        if "/EST/" in url:
            return _Resp("\n".join(["TIME_PERIOD,OBS_VALUE"] + [
                f"{date(2019, 10, 1) + timedelta(days=i)},2.0" for i in range(2700)]))
        raise AssertionError(url)


def _diaria(hasta: date, anos: int = 6, crec: float = 0.05) -> m.Serie:
    out, d = [], hasta - timedelta(days=365 * anos)
    p0 = d
    while d <= hasta:
        if d.weekday() < 5:
            out.append((d, round(100 * (1 + crec) ** ((d - p0).days / 365), 4)))
        d += timedelta(days=1)
    return out


def _relativas_del_fondo(indice: m.Serie, tmp_path, monkeypatch) -> dict:
    from core import indices
    fila = {"benchmark": "MSCI World", "variante": "NR", "proxy": "IE0000000099",
            "clase_de_serie": "VALOR_LIQUIDATIVO", "base": "TOTAL_RETURN", "declarado": None}
    monkeypatch.setenv("EODHD_API_TOKEN", "t")
    monkeypatch.setattr(indices, "proxy_de", lambda *a, **k: fila)
    monkeypatch.setattr(indices, "es_tasa", lambda *a, **k: False)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: indice)
    previo = {"ms": {"identificacion": {"nombre": "Fondo D EUR Acc", "indice_benchmark_oficial": "MSCI World NR USD"}}}
    with procedencia.activa("vl_eodhd"):
        # El fondo publica su último valor el viernes 30-10-2026, último laborable de octubre.
        out = vl_fondos.fetch("LU0000000041", _Http(_diaria(date(2026, 10, 30))), {}, base=tmp_path,
                              tipo="fondo", previo=previo)
    assert out["riesgo"]["fecha_dato"] == "2026-10-31"
    return out["riesgo"]["relativas"]


def test_el_fondo_mide_sus_relativas_al_cierre_de_su_riesgo(tmp_path, monkeypatch):
    rel = _relativas_del_fondo(_diaria(date(2026, 10, 30), crec=0.04), tmp_path, monkeypatch)
    assert rel["fecha_dato"] == "2026-10-31"


def test_el_fondo_dice_que_su_indice_no_llega_al_cierre(tmp_path, monkeypatch):
    """El índice se para el miércoles 30-09-2026: sin relativas, y la ficha dice hasta dónde llegaban juntas."""
    rel = _relativas_del_fondo(_diaria(date(2026, 9, 30), crec=0.04), tmp_path, monkeypatch)
    assert rel == {"aviso": "sin_relativas_indice_sin_cierre(2026-09-30)"}


# ------------------------------------------------------------------ MET-6: en el lector de acciones
def _config_de_accion(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "indices.csv").write_text(
        "benchmark,variante,proxy,clase_de_serie,base,fondos,nota\n"
        "MSCI Europe,NR,IE0007987708,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota\n", encoding="utf-8")
    (tmp_path / "config" / "indices_de_accion.csv").write_text(
        "bolsa,benchmark,alcance,nota\nMC,MSCI Europe,AREA,Espana\n", encoding="utf-8")


def _accion_e_indice(hasta_indice: date):
    aleatorio = random.Random(7)
    fin, d = date(2026, 10, 30), date(2026, 10, 30) - timedelta(days=365 * 6)
    indice, accion, i, a = [], [], 100.0, 100.0
    while d <= fin:
        if d.weekday() < 5:
            r = aleatorio.gauss(0.0004, 0.01)
            i *= 1 + r
            a *= 1 + 1.3 * r + aleatorio.gauss(0, 0.01)
            if d <= hasta_indice:
                indice.append((d, round(i, 4)))
            accion.append((d, round(a, 4)))
        d += timedelta(days=1)
    return accion, indice


@pytest.mark.parametrize("hasta_indice,fecha", [(date(2026, 10, 30), "2026-10-31"), (date(2026, 9, 30), None)])
def test_la_accion_mide_su_beta_al_ultimo_cierre_o_lo_dice(tmp_path, monkeypatch, hasta_indice, fecha):
    """La acción cotiza hasta el viernes 30-10-2026, último laborable de octubre: su beta es de octubre. Con la
    versión 3 era de septiembre. Si su referencia se para el 30-09, no hay beta y la ficha lo dice."""
    _config_de_accion(tmp_path)
    accion, indice = _accion_e_indice(hasta_indice)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: indice)
    monkeypatch.setattr(eodhd, "_token", lambda *a, **k: "t")
    out = {}
    eodhd._aplica_referencia(out, accion, "EODHD:SAN.MC", None, tmp_path)
    if fecha:
        assert out["riesgo"]["relativas"]["fecha_dato"] == fecha
        assert set(out["riesgo"]["relativas"]["beta"]) == {"3a", "5a"}
    else:
        assert out["riesgo"]["relativas"] == {"aviso": "sin_relativas_indice_sin_cierre(2026-09-30)"}


def test_la_cuenta_de_la_volatilidad_alterna():
    """Comprobación de la cuenta de arriba, sin el código del método: 0,1 × 12 / √11."""
    assert round(0.1 * 12 / math.sqrt(11) * 100, 4) == VOL_ALTERNA
