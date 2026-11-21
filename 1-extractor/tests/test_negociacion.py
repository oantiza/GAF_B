# -*- coding: utf-8 -*-
"""Lo que se negocia de lo que cotiza (decisión 108 de Óscar, 05-11-2026). Resultados a mano."""
from datetime import date, timedelta

from core import negociacion as n


def _sesiones(desde: date, cuantas: int, volumen=100, cierre=10.0):
    """Una fila por día hábil, con el volumen y el cierre que se le den, o una función del índice."""
    out, d = [], desde
    while len(out) < cuantas:
        if d.weekday() < 5:
            i = len(out)
            out.append({"date": d.isoformat(),
                        "close": cierre(i) if callable(cierre) else cierre,
                        "adjusted_close": cierre(i) if callable(cierre) else cierre,
                        "volume": volumen(i) if callable(volumen) else volumen})
        d += timedelta(days=1)
    return out


def test_la_mediana_es_de_volumen_por_cierre_y_sin_contar_las_sesiones_sin_volumen():
    filas = [
        {"date": "2026-01-05", "close": 10.0, "volume": 100},   # 1.000
        {"date": "2026-01-06", "close": 10.0, "volume": 0},     # no cuenta para la mediana
        {"date": "2026-01-07", "close": 20.0, "volume": 100},   # 2.000
        {"date": "2026-01-08", "close": 10.0, "volume": 400},   # 4.000
    ]
    assert n.de_filas(filas, "USD", "AS") == {
        "plaza": "AS", "divisa": "USD", "fecha_corte": "2026-01-08", "sesiones": 4, "sesiones_sin_volumen": 1,
        "mediana_negociada": 2000.0, "sesiones_de_la_mediana": 3,
    }


def test_doce_meses_desde_la_ultima_sesion_sin_contar_el_mismo_dia_del_anio_anterior():
    filas = [{"date": "2025-11-04", "close": 1.0, "volume": 1}, {"date": "2025-11-05", "close": 1.0, "volume": 3},
             {"date": "2026-11-04", "close": 1.0, "volume": 5}]
    dato = n.de_filas(filas, "EUR", "MC")
    assert dato["sesiones"] == 2
    assert dato["mediana_negociada"] == 4.0  # 3 y 5
    assert dato["fecha_corte"] == "2026-11-04"


def test_en_londres_el_cierre_va_en_peniques_y_el_importe_sale_en_libras():
    dato = n.de_filas([{"date": "2026-01-05", "close": 1000.0, "volume": 500}], "GBX", "LSE")
    assert dato["divisa"] == "GBP"
    assert dato["mediana_negociada"] == 5000.0  # 500 títulos a 10 libras


def test_un_volumen_a_cero_con_el_precio_moviendose_es_que_el_proveedor_no_lo_da():
    # El caso de ACCION IBEX 35: 261 de 261 a cero, con el precio distinto en 255.
    filas = _sesiones(date(2026, 1, 5), 10, volumen=0, cierre=lambda i: 10.0 + i)
    dato = n.de_filas(filas, "EUR", "MC")
    assert dato == {"plaza": "MC", "divisa": "EUR", "fecha_corte": dato["fecha_corte"], "sesiones": 10, "volumen": "NO_LO_DA_EL_PROVEEDOR"}


def test_un_volumen_a_cero_con_el_precio_parado_es_que_no_se_negocia():
    # El caso de Urbas: 255 de 255 a cero, y el precio no se mueve. No hay mediana, y eso no es un hueco del proveedor.
    dato = n.de_filas(_sesiones(date(2026, 1, 5), 10, volumen=0), "EUR", "MC")
    assert dato["sesiones_sin_volumen"] == 10
    assert "mediana_negociada" not in dato and "volumen" not in dato


def test_con_volumen_alguna_vez_siempre_se_dice_la_cuenta():
    # Fráncfort: casi siempre a cero, con el precio moviéndose, pero con alguna sesión con volumen: se da con su plaza.
    filas = _sesiones(date(2026, 1, 5), 10, volumen=lambda i: 50 if i == 9 else 0, cierre=lambda i: 10.0 + i)
    dato = n.de_filas(filas, "EUR", "F")
    assert dato["sesiones_sin_volumen"] == 9
    assert dato["mediana_negociada"] == 950.0  # 50 por 19


def test_un_desdoblamiento_deja_fuera_lo_de_antes():
    # El volumen ya viene ajustado y el cierre no: antes del de 25 por 1, el producto sale 25 veces mayor. El ajustado no salta.
    antes = [{"date": f"2026-03-{d:02d}", "close": 5000.0, "adjusted_close": 200.0, "volume": 1000} for d in range(2, 28)]
    despues = [{"date": f"2026-04-{d:02d}", "close": 200.0, "adjusted_close": 200.0, "volume": v} for d, v in ((6, 900), (7, 1000), (8, 1100))]
    dato = n.de_filas(antes + despues, "USD", "US")
    assert dato["mediana_negociada"] == 200000.0  # 1.000 títulos a 200, y no 5.000.000
    assert dato["sesiones_de_la_mediana"] == 3
    assert dato["sesiones"] == 29


def test_un_dividendo_no_es_un_desdoblamiento():
    filas = [{"date": "2026-03-02", "close": 100.0, "adjusted_close": 96.0, "volume": 10},
             {"date": "2026-03-03", "close": 100.0, "adjusted_close": 96.0, "volume": 30},
             {"date": "2026-03-04", "close": 96.0, "adjusted_close": 96.0, "volume": 20}]  # paga 4
    assert n.de_filas(filas, "EUR", "MC")["sesiones_de_la_mediana"] == 3


def test_una_serie_corta_dice_las_sesiones_que_tiene():
    assert n.de_filas(_sesiones(date(2026, 7, 16), 80), "EUR", "MC")["sesiones"] == 80


def test_sin_filas_no_hay_dato():
    assert n.de_filas([], "EUR", "MC") is None
    assert n.de_filas([{"date": "2026-01-05", "close": None, "volume": 1}], "EUR", "MC") is None


class _Lector:
    def filas(self, simbolo):
        return [{"date": "2026-01-05", "close": 2.0, "volume": 3}] if simbolo == "STOR.AS" else []


def test_un_fondo_no_lleva_nada_y_lo_que_cotiza_dice_su_plaza():
    fila = {"valoracion": {"vl_divisa": "USD"}, "riesgo": {"historial_precios": {"source_listing_id": "EODHD:STOR.AS"}}}
    assert n.de_ficha(fila, _Lector())["plaza"] == "AS"
    fondo = {"valoracion": {"vl_divisa": "EUR"}, "riesgo": {"historial_precios": {"source_listing_id": "EODHD:LU0232524495.EUFUND"}}}
    assert n.de_ficha(fondo, _Lector()) is None
    assert n.de_ficha({"riesgo": {"historial_precios": {"source_listing_id": "YAHOO:DIGI.MC"}}}, _Lector()) is None
    assert n.de_ficha({}, _Lector()) is None
