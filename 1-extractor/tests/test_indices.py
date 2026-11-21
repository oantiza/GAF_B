# -*- coding: utf-8 -*-
"""El proxy que replica cada indice, en un solo sitio.

Lo que vigila este fichero es que la eleccion de proxy no se pueda torcer sin
que falle algo. Un proxy mal elegido desplaza en SILENCIO todos los alphas
medidos contra el: medido el 01-11-2026 con las dos clases del mismo fondo
indice de MSCI World, una cubierta y otra no, la lectura cambia 4,9 puntos a un
anio y 1,7 anuales a cinco. No hay auditoria que cace eso despues.
"""
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import indices  # noqa: E402


def test_los_cuatro_proxies_aprobados_estan():
    indices.carga(RAIZ)
    esperados = {
        "MSCI Europe": "IE0007987708",
        "MSCI World": "IE00B03HD191",
        "MSCI EM": "IE0031786696",
        "MSCI ACWI": "IE00B6R52259",
    }
    for benchmark, isin in esperados.items():
        fila = indices.proxy_de(benchmark + " NR EUR", RAIZ)
        assert fila is not None, benchmark
        assert fila["proxy"] == isin, benchmark


def test_la_divisa_del_benchmark_NO_distingue():
    # Decidido el 01-11 que todo se calcula en euros, asi que «MSCI World NR USD»
    # y «NR EUR» son la misma serie convertida y caen en la misma fila.
    usd = indices.proxy_de("MSCI World NR USD", RAIZ)
    eur = indices.proxy_de("MSCI World NR EUR", RAIZ)
    assert usd is not None and eur is not None
    assert usd["proxy"] == eur["proxy"]


def test_la_variante_SI_distingue():
    # Un alpha contra la variante equivocada se desvia por la retencion fiscal
    # del indice. Si el benchmark pide GR y el proxy replica NR, no hay proxy.
    assert indices.proxy_de("MSCI World NR EUR", RAIZ) is not None
    assert indices.proxy_de("MSCI World GR EUR", RAIZ) is None
    assert indices.proxy_de("MSCI World PR EUR", RAIZ) is None


def test_un_indice_sin_proxy_devuelve_None_y_no_es_un_fallo():
    # De los 243 indices distintos de la base solo unos pocos tienen proxy
    # aprobado. Devolver None es lo que impide calcular un alpha contra un
    # indice que nadie ha verificado.
    assert indices.proxy_de("MSCI Frontier Markets NR USD", RAIZ) is None
    assert indices.proxy_de("", RAIZ) is None


def test_cada_proxy_declara_su_clase_de_serie():
    # Es lo que decide si se puede comparar con otra cifra. El ETF de ACWI es de
    # precio de mercado y los tres fondos indice de valor liquidativo.
    assert indices.proxy_de("MSCI ACWI NR USD", RAIZ)["clase_de_serie"] == "PRECIO_DE_MERCADO"
    for b in ("MSCI World NR EUR", "MSCI Europe NR EUR", "MSCI EM NR USD"):
        assert indices.proxy_de(b, RAIZ)["clase_de_serie"] == "VALOR_LIQUIDATIVO"


def test_una_tasa_apunta_al_ESTR_y_no_a_un_ISIN():
    # 55 fondos tienen por benchmark una tasa, no un indice, y el ESTR ya se trae
    # del BCE: no hace falta instrumento ni inventarse un ISIN.
    fila = indices.proxy_de("Euro Short Term Rate", RAIZ)
    assert fila is not None
    assert fila["proxy"] == indices.PROXY_ESTR
    assert fila["clase_de_serie"] == "TASA"
    assert indices.es_tasa(fila) is True
    assert indices.es_tasa(indices.proxy_de("MSCI World NR EUR", RAIZ)) is False


def test_el_nombre_frances_del_ESTR_tambien_casa():
    # El canonico lo trae como «€STR capitalisé Jour TR EUR», con el simbolo del
    # euro y una tilde. Si el plegado no los normaliza, 9 fondos se quedan fuera.
    assert indices.proxy_de("€STR capitalisé Jour TR EUR", RAIZ) is not None


def test_una_clase_de_serie_inventada_rompe_la_carga():
    # Vale mas que falle la carga que publicar una cifra cuya comparabilidad
    # nadie declaro.
    tmp = RAIZ / "config" / "indices_prueba_tmp.csv"
    destino = tmp.parent / "indices.csv"
    original = destino.read_text(encoding="utf-8")
    try:
        destino.write_text(
            "benchmark,variante,proxy,clase_de_serie,fondos,nota\n"
            "Lo Que Sea,NR,IE0000000000,INVENTADA,1,nota\n", encoding="utf-8")
        indices._CACHE.clear()
        with pytest.raises(ValueError):
            indices.carga(RAIZ)
    finally:
        destino.write_text(original, encoding="utf-8")
        indices._CACHE.clear()
    assert not tmp.exists()


def test_sin_base_no_hay_tabla_y_no_se_cae():
    assert indices.carga(None) == {}
    assert indices.proxy_de("MSCI World NR EUR", None) is None


def test_la_base_del_indice_NO_es_la_clase_de_serie():
    """Las dos responden a preguntas distintas y confundirlas cuesta 69 fondos.

    El 01-11-2026 deduje la base de la clase de serie: PRECIO_DE_MERCADO ->
    PRICE_RETURN. Es falso. El precio de un ETF de ACUMULACION incluye los
    dividendos reinvertidos, asi que su serie es de retorno total aunque sea
    precio de mercado. Deducirlo dejaba sin alpha a los 69 fondos de MSCI ACWI
    por una razon que no existia.

    La base dice si se puede calcular el alpha. La clase de serie dice cuanto
    ruido lleva la cifra: un ETF cotizado infla la volatilidad 1,2 puntos a un
    anio frente al valor liquidativo de un fondo indice.
    """
    acwi = indices.proxy_de("MSCI ACWI NR USD", RAIZ)
    assert acwi["clase_de_serie"] == "PRECIO_DE_MERCADO"
    assert acwi["base"] == "TOTAL_RETURN", "un ETF de acumulacion es retorno total"
    world = indices.proxy_de("MSCI World NR EUR", RAIZ)
    assert world["clase_de_serie"] == "VALOR_LIQUIDATIVO"
    assert world["base"] == "TOTAL_RETURN"


def test_una_base_inventada_rompe_la_carga():
    destino = RAIZ / "config" / "indices.csv"
    original = destino.read_text(encoding="utf-8")
    try:
        destino.write_text(
            "benchmark,variante,proxy,clase_de_serie,base,fondos,nota\n"
            "Lo Que Sea,NR,IE0000000000,VALOR_LIQUIDATIVO,INVENTADA,1,nota\n", encoding="utf-8")
        indices._CACHE.clear()
        with pytest.raises(ValueError):
            indices.carga(RAIZ)
    finally:
        destino.write_text(original, encoding="utf-8")
        indices._CACHE.clear()


def test_una_accion_toma_su_referencia_de_donde_cotiza():
    assert indices.referencia_de_accion("SAN.MC", RAIZ)["fila"]["benchmark"] == "MSCI Europe"
    assert indices.referencia_de_accion("SAN.MC", RAIZ)["alcance"] == "AREA"
    # Medtronic tiene ISIN irlandes y cotiza en Nueva York.
    assert indices.referencia_de_accion("MDT.US", RAIZ)["fila"]["benchmark"] == "S&P 500"
    assert indices.referencia_de_accion("MDT.US", RAIZ)["alcance"] == "MERCADO"


def test_sin_referencia_decidido_no_es_lo_mismo_que_nadie_lo_ha_mirado():
    canada = indices.referencia_de_accion("RY.TO", RAIZ)
    assert canada["alcance"] == "SIN_REFERENCIA" and canada["fila"] is None
    assert indices.referencia_de_accion("ALGO.XX", RAIZ) is None
    assert indices.referencia_de_accion("SIN_BOLSA", RAIZ) is None


# --- 06-11-2026: el nombre en su forma larga, y el proxy de un índice equivalente ---------------

@pytest.mark.parametrize("declarado, variante", [
    ("MSCI World Net TR EUR", "NR"),
    ("MSCI World Net Total Return", "NR"),
    ("MSCI World Index Net", "NR"),
    ("MSCI EMU Net Return Index EUR", "NR"),
    ("MSCI Europe Net TR in EUR", "NR"),
    ("MSCI ACWI Net TR EUR", "NR"),
    ("MSCI All Countries World (NTR)", "NR"),
    ("S&P 500 (TR) (1970)", "TR"),
    ("EURO STOXX 50 Price", "PR"),
    ("MSCI World GR EUR", "GR"),
    ("MSCI World Gross Total Return", "GR"),
    ("Bloomberg Euro Agg Bond Total Return", "TR"),
])
def test_la_variante_se_lee_tambien_en_su_forma_larga(declarado, variante):
    # «Net TR» es la variante NR. Leída como TR, el fondo se quedaba sin relativas por la forma
    # de escribir el nombre, no por el índice.
    assert indices.variante_de(declarado) == variante


def test_la_forma_larga_casa_con_la_misma_fila_que_la_corta():
    for declarado in ("MSCI World Net TR EUR", "MSCI World Net Total Return", "MSCI World Index Net"):
        fila = indices.proxy_de(declarado, RAIZ)
        assert fila is not None and fila["proxy"] == "IE00B03HD191", declarado
    assert indices.pliega("MSCI Europe Net TR in EUR") == indices.pliega("MSCI Europe NR EUR")
    assert indices.pliega("JPM EMU Bond Index 1-3") == "jpm emu bond 1 3"


def test_el_ano_base_no_es_otro_indice_pero_la_variante_sigue_mandando():
    # «S&P 500 (TR) (1970)» es el S&P 500: casa con su nombre. Pero pide TR, y hasta el 07-11 el
    # único proxy era NR, así que no había proxy: aceptar esa diferencia es una aprobación, no una
    # normalización. Desde la decisión 28 hay una fila TR (el nivel del índice), y es ESA la que
    # casa: la NR de Vanguard sigue sin servir para un fondo que declara TR.
    assert indices.pliega("S&P 500 (TR) (1970)") == indices.pliega("S&P 500")
    fila = indices.proxy_de("S&P 500 (TR) (1970)", RAIZ)
    assert fila["variante"] == "TR" and fila["proxy"] != "IE0032126645"
    assert indices.proxy_de("S&P 500 GR USD", RAIZ) is None


def test_price_solo_es_variante_al_final_del_nombre():
    assert indices.variante_de("LBMA Gold Price PM USD") is None
    assert "price" in indices.pliega("LBMA Gold Price PM USD")
    assert indices.variante_de("EURO STOXX 50 Price") == "PR"


def test_net_es_una_palabra_y_no_un_trozo():
    assert indices.variante_de("Secured Overnight Financing Rate(SOFR)") is None


def _tabla(tmp_path, filas):
    (tmp_path / "config").mkdir(exist_ok=True)
    (tmp_path / "config" / "indices.csv").write_text(
        "benchmark,variante,proxy,clase_de_serie,base,fondos,nota,equivalente_de\n" + "\n".join(filas) + "\n",
        encoding="utf-8")
    indices._CACHE.clear()


def test_un_proxy_equivalente_dice_contra_que_se_midio_y_a_que_equivale(tmp_path):
    _tabla(tmp_path, [
        'Markit iBoxx EUR Liquid Corporates,TR,LU0478205379,PRECIO_DE_MERCADO,TOTAL_RETURN,2,'
        '"prueba, con coma",ICE BofA Euro Corporate; ICE BofA Euro Large Cap Corporate'])
    declarado = indices.proxy_de("ICE BofA Euro Corporate TR EUR", tmp_path)
    assert declarado["proxy"] == "LU0478205379"
    assert declarado["benchmark"] == "Markit iBoxx EUR Liquid Corporates", "el que de verdad se mide"
    assert declarado["declarado"] == "ICE BofA Euro Corporate"
    assert declarado["nota"] == "prueba, con coma"
    assert indices.proxy_de("ICE BofA Euro Large Cap Corporate TR EUR", tmp_path)["declarado"]
    # Quien declara el índice medido casa sin equivalencia.
    assert indices.proxy_de("Markit iBoxx EUR Liquid Corporates TR", tmp_path)["declarado"] is None
    # La variante sigue mandando también en la equivalencia.
    assert indices.proxy_de("ICE BofA Euro Corporate PR EUR", tmp_path) is None


def test_el_ice_bofa_euro_corporate_se_mide_contra_el_bloomberg_y_lo_dice():
    """La equivalencia aprobada el 08-11-2026, sobre la tabla real: la fila medida no se hace pasar por
    la declarada, el Bloomberg sigue sin equivalencia y otro ICE BofA del mismo apellido no entra."""
    fila = indices.proxy_de("ICE BofA Euro Corporate TR EUR", RAIZ)
    assert (fila["benchmark"], fila["variante"], fila["proxy"]) == ("Bloomberg Euro Corp", "TR", "IE00B3T9LM79")
    assert fila["declarado"] == "ICE BofA Euro Corporate"
    assert indices.proxy_de("Bloomberg Euro Corp TR EUR", RAIZ)["declarado"] is None
    assert indices.proxy_de("ICE BofA 1-3 Year Euro Corporate SEKhdg", RAIZ) is None


def test_un_nombre_con_fila_propia_no_puede_ser_equivalente_de_otra(tmp_path):
    _tabla(tmp_path, [
        "MSCI World,NR,IE00B03HD191,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota,",
        "FTSE Developed,NR,IE00BK5BQV03,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota,MSCI World"])
    with pytest.raises(ValueError):
        indices.carga(tmp_path)
    indices._CACHE.clear()


def test_sin_columna_de_equivalencia_la_tabla_vieja_sigue_cargando(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "indices.csv").write_text(
        "benchmark,variante,proxy,clase_de_serie,base,fondos,nota\n"
        "MSCI World,NR,IE00B03HD191,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota\n", encoding="utf-8")
    indices._CACHE.clear()
    fila = indices.proxy_de("MSCI World NR EUR", tmp_path)
    assert fila["equivalente_de"] == () and fila["declarado"] is None
    indices._CACHE.clear()


def test_ninguna_nota_de_la_tabla_real_se_parte_por_una_coma():
    # Seis notas llevaban una coma sin comillas: el CSV partía la nota y la segunda mitad
    # caía fuera de su columna. Con `equivalente_de` detrás, habría caído en ella.
    import csv
    with (RAIZ / "config" / "indices.csv").open(encoding="utf-8-sig", newline="") as fh:
        lector = csv.reader(fh)
        cabecera = next(lector)
        for fila in lector:
            assert len(fila) == len(cabecera), fila[0]
    for fila in indices.carga(RAIZ).values():
        assert fila["declarado"] is None or fila["equivalente_de"], fila["benchmark"]


def test_los_tres_proxies_aprobados_el_06_11():
    # Aprobados por Óscar fila a fila (INFORME_PROXIES_CAMINO_A_2026-11-06.md, sección 1).
    esperados = {
        "MSCI India NR USD": "IE00BZCQB185",
        "MSCI India NR EUR": "IE00BZCQB185",
        "EURO STOXX 50 NR EUR": "IE00B53L3W79",
        "MSCI EMU Small Cap NR EUR": "IE00B3VWMM18",
        "MSCI EMU Small Cap": "IE00B3VWMM18",
    }
    for declarado, isin in esperados.items():
        fila = indices.proxy_de(declarado, RAIZ)
        assert fila is not None and fila["proxy"] == isin, declarado
        assert "aprobado por Oscar el 06-11" in fila["nota"], declarado
    # Lo que la tabla dejó fuera sigue fuera: otra variante, otro índice o el camino C.
    for fuera in ("MSCI India GR USD", "MSCI India 10/40 NR USD", "MSCI India IMI NR USD",
                  "EURO STOXX 50 Price", "MSCI EMU NR EUR"):
        fila = indices.proxy_de(fuera, RAIZ)
        assert fila is None or fila["proxy"] not in ("IE00BZCQB185", "IE00B53L3W79", "IE00B3VWMM18"), fuera


def test_todo_proxy_de_mercado_esta_en_el_universo():
    # Un proxy de precio de mercado se lee de su ficha en data/funds: si no está en el universo,
    # nunca tendrá ficha y el alfa no se calcula, sin avisar.
    import csv
    with (RAIZ / "config" / "fondos.csv").open(encoding="utf-8-sig", newline="") as fh:
        universo = {f["isin"].strip().upper() for f in csv.DictReader(fh)}
    for fila in indices.carga(RAIZ).values():
        if fila["clase_de_serie"] == "PRECIO_DE_MERCADO":
            assert fila["proxy"] in universo, fila["benchmark"]


# ------------------------------------------------- camino C: nivel de índice (decisiones 23 y 28)
def test_dos_variantes_del_mismo_indice_conviven_y_cada_fondo_casa_con_la_suya():
    # «S&P 500 (TR) (1970)» y «S&P 500 NR USD» pliegan al mismo nombre. Con la clave solo por
    # nombre, la fila del TR pisaba en silencio la del NR, que mide a 3 fondos.
    nr = indices.proxy_de("S&P 500 NR USD", RAIZ)
    tr = indices.proxy_de("S&P 500 (TR) (1970)", RAIZ)
    assert nr["proxy"] == "IE0032126645" and nr["clase_de_serie"] == "VALOR_LIQUIDATIVO"
    assert tr["proxy"] == "SP500TR.INDX" and tr["clase_de_serie"] == "NIVEL_DE_INDICE"
    assert indices.proxy_de("S&P 500 GR USD", RAIZ) is None


def test_un_nombre_sin_variante_no_elige_entre_dos_filas():
    # «EURO STOXX 50» a secas no es ni el de precio ni el NR: con dos filas, no se adivina.
    assert indices.proxy_de("EURO STOXX 50", RAIZ) is None
    assert indices.proxy_de("EURO STOXX 50 Price", RAIZ)["proxy"] == "SX5E.INDX"
    assert indices.proxy_de("EURO STOXX 50 NR EUR", RAIZ)["proxy"] == "IE00B53L3W79"
    # Con una sola fila, el nombre sin variante sigue casando, como siempre.
    assert indices.proxy_de("MSCI EMU Small Cap", RAIZ)["proxy"] == "IE00B3VWMM18"


def test_las_cinco_filas_de_nivel_de_indice_aprobadas_el_07_11():
    esperados = {
        "BME IBEX 35 TR EUR": ("IBEXTR.INDX", "TOTAL_RETURN"),
        "Ibex 35 TR EUR": ("IBEXTR.INDX", "TOTAL_RETURN"),
        "BME IBEX 35 PR EUR": ("IBEX.INDX", "PRICE_RETURN"),
        "EURO STOXX 50 Price": ("SX5E.INDX", "PRICE_RETURN"),
        "S&P 500 (TR) (1970)": ("SP500TR.INDX", "TOTAL_RETURN"),
        "S&P 500 Equal Weighted TR USD": ("SPXEWTR.INDX", "TOTAL_RETURN"),
    }
    for declarado, (simbolo, base) in esperados.items():
        fila = indices.proxy_de(declarado, RAIZ)
        assert fila is not None, declarado
        assert (fila["proxy"], fila["base"]) == (simbolo, base), declarado
        assert indices.es_nivel_de_indice(fila)
        assert "aprobado por Oscar el 07-11" in fila["nota"], declarado
    # EDM declara el IBEX 35 NR, que EODHD no tiene: sin relativas (decisión 25).
    assert indices.proxy_de("BME IBEX 35 NR EUR", RAIZ) is None
    assert not indices.es_nivel_de_indice(indices.proxy_de("MSCI World NR EUR", RAIZ))


def test_la_misma_fila_dos_veces_rompe_la_carga(tmp_path):
    _tabla(tmp_path, [
        "MSCI World,NR,IE00B03HD191,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota,",
        "MSCI World,NR,IE0007987708,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota,"])
    with pytest.raises(ValueError):
        indices.carga(tmp_path)
    indices._CACHE.clear()


@pytest.mark.parametrize("fila", [
    "IBEX 35,TR,IBEXTR,NIVEL_DE_INDICE,TOTAL_RETURN,1,sin bolsa,",
    "IBEX 35,TR,ES0SI0000005,NIVEL_DE_INDICE,TOTAL_RETURN,1,un ISIN no es un nivel de indice,",
    "IBEX 35,TR,IBEXTR.INDX,PRECIO_DE_MERCADO,TOTAL_RETURN,1,un simbolo INDX no es un ETF,",
])
def test_un_nivel_de_indice_es_un_simbolo_INDX_y_solo_el(tmp_path, fila):
    _tabla(tmp_path, [fila])
    with pytest.raises(ValueError):
        indices.carga(tmp_path)
    indices._CACHE.clear()


def test_la_equivalencia_respeta_la_variante_de_su_fila(tmp_path):
    # «Ibex 35» es equivalente de las dos filas del BME IBEX 35, cada una con su variante.
    _tabla(tmp_path, [
        "BME IBEX 35,TR,IBEXTR.INDX,NIVEL_DE_INDICE,TOTAL_RETURN,0,nota,Ibex 35",
        "BME IBEX 35,PR,IBEX.INDX,NIVEL_DE_INDICE,PRICE_RETURN,0,nota,Ibex 35"])
    assert indices.proxy_de("Ibex 35 TR EUR", tmp_path)["proxy"] == "IBEXTR.INDX"
    assert indices.proxy_de("Ibex 35 PR EUR", tmp_path)["proxy"] == "IBEX.INDX"
    assert indices.proxy_de("Ibex 35 NR EUR", tmp_path) is None
    indices._CACHE.clear()
