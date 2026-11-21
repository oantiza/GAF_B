# -*- coding: utf-8 -*-
"""La misma metrica tiene dos puertas, y estas pruebas lo dejan por escrito.

El 02-11-2026 la mitad del metodo —volatilidad, Sharpe y caida maxima de las
acciones— vivia dentro de `fetchers/eodhd.py`, el lector de un proveedor. Se
movio a `core.metricas` **sin tocar ningun umbral**, y aqui se fijan las dos
cosas que ese movimiento no decide:

1. Los umbrales de la puerta diaria, para que nadie los mueva sin querer.
2. Que las dos puertas **no dan la misma respuesta** sobre la misma serie. Cual
   de las dos es la correcta esta sin decidir; que se contradicen, no.
"""
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402


def serie_diaria(n: int, inicio: date = date(2021, 1, 4)) -> list:
    """Serie determinista —sin azar— para poder congelar las cifras."""
    return [(inicio + timedelta(days=i),
             100 * (1 + 0.02 * math.sin(i / 7) + 0.0005 * i)) for i in range(n)]


def serie_poco_liquida(desde: date, hasta: date) -> list:
    """La forma de CEVASA: cotiza uno de cada dos dias habiles.

    Cubre todos los meses del periodo, asi que la puerta mensual la deja pasar,
    y no junta 180 observaciones en un anyo, asi que la diaria no.
    """
    s, f, habiles, i = [], desde, 0, 0
    while f <= hasta:
        if f.weekday() < 5:
            habiles += 1
            if habiles % 2 == 0:
                s.append((f, 100 * (1 + 0.03 * math.sin(i / 11) + 0.0004 * i)))
                i += 1
        f += timedelta(days=1)
    return s


# ----------------------------------------------- la puerta diaria y su umbral
def test_el_umbral_diario_es_el_que_era():
    # max(60, anyos * 180). Si alguien lo cambia, cambia la cifra publicada de
    # las 302 acciones del alcance, y eso es una decision, no un refactor.
    assert m.minimo_observaciones(1) == 180
    assert m.minimo_observaciones(3) == 540
    assert m.minimo_observaciones(5) == 900
    # El suelo de 60 solo asoma por debajo de un anyo.
    assert m.MIN_OBSERVACIONES_DIARIAS == 60
    assert m.minimo_observaciones(0) == 60


def test_el_umbral_corta_donde_dice_cortar():
    estr = [(f, 2.0) for f, _ in serie_diaria(400)]
    justo_debajo = serie_diaria(179)
    justo_encima = serie_diaria(180)
    assert m.metricas_diarias(justo_debajo, 1, estr) is None
    assert m.metricas_diarias(justo_encima, 1, estr) is not None


def test_las_cifras_diarias_estan_congeladas():
    """Las mismas cifras que daba el codigo dentro del lector de EODHD.

    Comprobado el 02-11-2026 contra una copia literal de aquel codigo sobre 552
    combinaciones —los bordes de cada ventana, anyo bisiesto, precios a cero y
    negativos, serie plana y cuatro regimenes de €STR—: ninguna cambio.

    Version 3 (decision A-158, 16-11-2026): cambian la volatilidad y, con ella, el Sharpe.
    Esta serie tiene un punto CADA DIA NATURAL, 365 rentabilidades en 365 dias, asi que al
    anyo hay 365,25 y no 252. La desviacion tipica diaria no cambia: la de la version 2 era
    2,9205 / raiz(252), y la de ahora es esa misma por raiz(365,25):

        2,9205 x raiz(365,25 / 252) = 2,9205 x 1,20391 = 3,5160

    y el Sharpe, (21,1764 - 2,0) / 3,5160 = 5,4540. Lo demas sale igual que el 02-11.
    """
    s = serie_diaria(400)
    estr = [(f, 2.0) for f, _ in s]
    r = m.metricas_diarias(s, 1, estr)
    assert r.pop("volatilidad") == pytest.approx(3.5160, abs=2e-4)
    assert r.pop("sharpe") == pytest.approx(5.4540, abs=5e-4)
    assert r == {
        "rent_anualizada": 21.1764,
        "rf_pct": 2.0,
        "max_drawdown": -2.8246,
        "observaciones": 366,
        "fecha_inicio": "2021-02-07",
        "fecha_fin": "2022-02-07",
    }


def test_sin_estr_no_hay_sharpe_pero_si_volatilidad():
    # El Sharpe no se suprime nunca por conveniencia; se deja vacio cuando falta
    # el tipo libre de riesgo, que es distinto de valer cero.
    s = serie_diaria(400)
    sin = m.metricas_diarias(s, 1, None)
    assert sin["sharpe"] is None and sin["rf_pct"] is None
    # 2,9205 de la version 2 por raiz(365,25 / 252): ver la prueba de arriba.
    assert sin["volatilidad"] == pytest.approx(3.5160, abs=2e-4)


# ------------------------------------------- las dos puertas se contradicen
def test_las_dos_puertas_no_son_la_misma():
    # Contar observaciones no es exigir meses consecutivos. Si algun dia se
    # unifican sera porque alguien lo decidio, y esta prueba habra que cambiarla
    # a mano.
    assert m.minimo_observaciones(1) == 180          # diaria: cuantas hay
    # mensual: n+1 cierres de mes SEGUIDOS. La ventana de 10 años entra el 02-11-2026, por
    # decision de Oscar: el contrato declaraba `volatility.10y`, `sharpe.10y` y
    # `sortino.10y` y aqui no existia la ventana, asi que figuraban ausentes en los 1.077.
    # No cambia ninguna cifra ya publicada; añade una que antes no se calculaba.
    assert m.VENTANAS_RIESGO == (("1a", 12), ("3a", 36), ("5a", 60), ("10a", 120))


def test_una_serie_poco_liquida_tiene_cifra_por_un_camino_y_no_por_el_otro():
    """El caso CEVASA (ES0132955008), medido el 02-11-2026.

    Cinco anyos de historia y ni una cifra por el camino diario, porque el
    umbral esta en numero de observaciones y mezcla dos cosas distintas: una
    serie corta y una serie poco liquida. Por el camino mensual si la hay.
    """
    pl = serie_poco_liquida(date(2021, 11, 2), date(2026, 11, 2))
    for anos in (1, 3, 5):
        assert m.metricas_diarias(pl, anos, None) is None, anos
    mensual = m.riesgo(pl)
    assert mensual["1a"]["volatilidad"] is not None
    assert mensual["3a"]["volatilidad"] is not None
    # A cinco anyos tampoco llega por el camino mensual, y por otro motivo: le
    # faltan cierres de mes (59 de los 61 que exige la ventana).
    assert len(m.fin_de_mes(pl)) == 59
    assert "5a" not in mensual


def test_la_caida_maxima_de_la_ventana_no_es_la_de_tres_anyos():
    # Dos definiciones distintas en el mismo modulo, a proposito: `caida_maxima`
    # exige que la serie cubra su ventana y devuelve None si no; la de la ventana
    # diaria mide lo que haya en la ventana que ya paso la puerta.
    corta = serie_diaria(200)
    assert m.caida_maxima(corta) is None
    assert m._caida_maxima_ventana(corta) is not None


def test_el_modulo_declara_las_dos_puertas():
    # Que esten las dos no es el problema; que no se supiera, si.
    doc = m.__doc__ or ""
    assert "dos puertas" in doc
    assert "metricas_diarias" in doc and "riesgo" in doc
