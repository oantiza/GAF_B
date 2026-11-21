"""El índice de Morningstar contrastado con el KID (core/indice_kid.py, 07-11-2026).

Los textos de `fixtures/kid_indice_*.txt` son la lectura (`indice_kid.texto_lectura`) de KID
reales de `cache/kid/`, que no va al repositorio. Cada uno, con su origen y la huella del
documento que la ficha tenía ese día:

- completo, LU0203975437: deutsche_bank_es, huella eb01a4f069c2703f…
- marca, LU1103307408: goldman_sachs, huella e1cfc82046e0ff1d…
- compuesto, LU0910636546: goldman_sachs, huella 046370d4967a7947…
- sin índice, LU1295551144: deutsche_bank_es, huella 2e70d6219ccce82b…
- no confirmado, ES0156873004: cnmv, huella 6acc85cbed79a309…
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from core import indice_kid, kid
from core.adaptador_bdb import convierte

FIXTURES = Path(__file__).parent / "fixtures"


def _texto(caso: str, isin: str) -> str:
    return (FIXTURES / f"kid_indice_{caso}_{isin}.txt").read_text(encoding="utf-8")


# ------------------------------------------------------------- KID reales, un estado cada uno
def test_kid_que_nombra_el_indice_entero():
    r = indice_kid.compara("MSCI World NR EUR", _texto("completo", "LU0203975437"))
    assert r["estado"] == "CONFIRMADO_COMPLETO"
    assert "MSCI World Index" in r["texto_del_kid"]


def test_kid_que_nombra_otro_indice_de_la_misma_marca_baja_a_marca_y_dice_que_falta():
    # Morningstar le atribuye el T-Bill de EE. UU. y el KID dice el alemán: la marca casa,
    # el índice no. `faltan` es lo que lo delata.
    r = indice_kid.compara("ICE BofA US 3M Trsy Bill TR USD", _texto("marca", "LU1103307408"))
    assert r["estado"] == "CONFIRMADO_MARCA"
    assert r["faltan"] == ["us"]
    assert "German Treasury Bill" in r["texto_del_kid"]


def test_kid_con_indice_compuesto_aunque_morningstar_nombre_una_pieza_entera():
    # El caso medido el 06-11 en los fondos del GBI-EM: Morningstar se queda con la pieza del
    # 50 %, y su nombre casaría entero con la frase. Compuesto va delante por eso.
    r = indice_kid.compara("JPM GBI-EM Global Diversified TR USD", _texto("compuesto", "LU0910636546"))
    assert r["estado"] == "COMPUESTO"
    assert "50% JP Morgan GBI-EM" in r["texto_del_kid"]
    assert "25% JP Morgan EMBI" in r["texto_del_kid"]


def test_kid_que_dice_no_tener_indice():
    r = indice_kid.compara("MSCI ACWI NR USD", _texto("sin_indice", "LU1295551144"))
    assert r["estado"] == "KID_SIN_INDICE"
    assert r["texto_del_kid"] == "No se gestiona en relación con un valor de referencia."


def test_kid_que_habla_de_otro_indice_de_otra_marca():
    # Morningstar dice Bloomberg Euro Agg 1-3; el KID toma como referencia el €STR.
    r = indice_kid.compara("Bloomberg Barclays Euro Agg 1-3Y", _texto("no_confirmado", "ES0156873004"))
    assert r["estado"] == "NO_CONFIRMADO"
    assert "€STR" in r["texto_del_kid"]


def test_las_citas_no_pasan_de_200_caracteres_y_son_literales():
    for caso, isin, nombre in (("completo", "LU0203975437", "MSCI World NR EUR"),
                               ("compuesto", "LU0910636546", "JPM GBI-EM Global Diversified TR USD")):
        texto = _texto(caso, isin)
        cita = indice_kid.compara(nombre, texto)["texto_del_kid"]
        assert len(cita) <= indice_kid.MAX_TEXTO
        # Literal: está en el texto del KID tal cual, con los espacios aplanados.
        assert cita in " ".join(texto.split())


# -------------------------------------------------------------------------- la normalización
@pytest.mark.parametrize("ms, kid_dice", [
    ("JPM GBI-EM Global Diversified TR USD",
     "J.P. Morgan Government Bond Index-Emerging Markets Global Diversified"),
    ("JPM EMBI Global Diversified TR USD", "JPMorgan EMBI Global Diversified Index"),
    ("ICE BofA Euro Corporate TR EUR", "BofA Merrill Lynch Euro Corporate Index"),
    ("BBgBarc Euro Agg 1-3Y TR EUR", "Bloomberg Barclays Euro Aggregate 1-3 Year Index"),
    ("S&P 500 (TR) (1970)", "Standard & Poor's 500 Net Total Return"),
    ("S&P 500 Equal Weighted TR USD", "S&P500 Equal Weight Index (TR)"),
    ("MSCI ACWI NR USD", "MSCI All Country World Index"),
    ("MSCI Brazil 10/40 NR USD", "MSCI Brazil 10-40 Index"),
    ("EURO STOXX 50 NR EUR", "Eurostoxx50 Net Return"),
    ("BME IBEX 35 PR EUR", "IBEX35"),
    ("€STER Capitalisé EUR", "€STR capitalizado"),
    ("EURIBOR 3M TR EUR", "Euribor a 3 meses"),
    ("TOPIX TR JPY", "Tokyo Stock Price Index Net TR"),
    ("MSCI ACWI Me&Mi 30% Bf 10/40 NR USD", "MSCI ACWI Metals and Mining 30% Buffer 10/40 Index"),
    ("ICE BofA EUR HY Constnd TR EUR", "ICE BofA Euro High Yield Constrained Index"),
])
def test_la_ortografia_no_hace_un_no_confirmado(ms, kid_dice):
    assert indice_kid.normaliza(ms) == indice_kid.normaliza(kid_dice) or \
        set(indice_kid.normaliza(ms)) <= set(indice_kid.normaliza(kid_dice))


@pytest.mark.parametrize("ms, kid_dice", [
    ("MSCI World 100% Hdg NR EUR", "MSCI World Index"),           # la cobertura distingue
    ("MSCI Europe Small Cap NR EUR", "MSCI Europe Index"),         # el tamaño distingue
    ("ICE BofA 1-3Y Euro Govt", "ICE BofA 3-5 Year Euro Government Index"),   # el tramo distingue
])
def test_lo_que_distingue_un_indice_se_queda(ms, kid_dice):
    assert not set(indice_kid.normaliza(ms)) <= set(indice_kid.normaliza(kid_dice))


def test_un_mas_dentro_del_nombre_no_es_un_compuesto():
    texto = ("Objetivos. El fondo utiliza como índice de referencia de comparación el índice "
             "MSCI EFM Europe + CIS (E+C) Index (Net TR).")
    assert indice_kid.compara("MSCI EFM Europe + CIS (E+C) NR EUR", texto)["estado"] == "CONFIRMADO_COMPLETO"


def test_los_porcentajes_de_una_tabla_de_escenarios_no_son_piezas():
    texto = ("El índice de referencia es el MSCI Europe Index. Desfavorable Lo que podría recibir "
             "tras deducir los costes 8,520 EUR 11,700 EUR Rendimiento medio cada año -14,8% 3,2% Moderado.")
    assert indice_kid.compara("MSCI Europe NR EUR", texto)["estado"] == "CONFIRMADO_COMPLETO"


# ---------------------------------------------------------- la huella y el KID de la ficha
def _pdf(ruta: Path, texto: str) -> str:
    """Un PDF con ese texto en `ruta`; devuelve la huella que le daría la ficha."""
    import fitz
    doc = fitz.open()
    pagina = doc.new_page()
    pagina.insert_textbox(fitz.Rect(40, 40, 560, 800), texto, fontsize=9)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(ruta))
    doc.close()
    return hashlib.sha256(kid.texto_pdf(ruta).encode("utf-8")).hexdigest()


def test_sin_kid_en_la_ficha():
    r = indice_kid.comprueba("LU0000000001", "MSCI World NR USD", None, Path("."))
    assert r["estado"] == "SIN_KID" and r["motivo"] == "ficha_sin_kid"
    assert r["indice_morningstar"] == "MSCI World NR USD"


def test_el_kid_de_la_cache_tiene_que_ser_el_de_la_ficha(tmp_path):
    isin = "LU0000000002"
    huella = _pdf(tmp_path / "cache" / "kid" / "gestoras" / "dws" / f"{isin}_a.pdf",
                  "Objetivos. Indice de referencia: MSCI World Index.")
    bien = indice_kid.comprueba(isin, "MSCI World NR USD", huella, tmp_path)
    assert bien["estado"] == "CONFIRMADO_COMPLETO" and bien["kid_sha256"] == huella
    # Un documento nuevo puede decir otra cosa: con otra huella no se lee.
    otro = indice_kid.comprueba(isin, "MSCI World NR USD", "0" * 64, tmp_path)
    assert otro["estado"] == "SIN_KID" and otro["motivo"] == "kid_de_la_ficha_no_en_cache"


# --------------------------------------------------------------- la fuente y el canónico
def test_la_fuente_prefiere_lo_de_esta_pasada_y_calla_sin_indice(tmp_path):
    from fetchers import indice_kid as fuente
    isin = "LU0000000003"
    huella = _pdf(tmp_path / "cache" / "kid" / "amf" / f"{isin}_1.pdf",
                  "Objetivos. Indice de referencia: MSCI Europe Index.")
    previo = {
        "_anterior": {"identificacion": {"indice_benchmark_oficial": "MSCI World NR USD"},
                      "documentos_oficiales": {"kid_sha256": "f" * 64}},
        "morningstar_lt": {"identificacion": {"indice_benchmark_oficial": "MSCI Europe NR EUR"}},
        "amf_geco": {"documentos_oficiales": {"kid_sha256": huella}},
    }
    out = fuente.fetch(isin, base=tmp_path, previo=previo)
    bloque = out["identificacion"]["indice_benchmark_kid"]
    assert bloque["estado"] == "CONFIRMADO_COMPLETO"
    assert bloque["indice_morningstar"] == "MSCI Europe NR EUR"
    assert bloque["kid_sha256"] == huella
    # Sin índice de Morningstar no hay nada que contrastar, y el bloque no aparece.
    assert fuente.fetch(isin, base=tmp_path, previo={"amf_geco": previo["amf_geco"]}) == {}
    # «N/A» no es un índice.
    sin = {"morningstar_lt": {"identificacion": {"indice_benchmark_oficial": "N/A"}}}
    assert fuente.fetch(isin, base=tmp_path, previo=sin) == {}


def test_el_bloque_viaja_al_canonico_sin_tocar_el_indice():
    bloque = {"estado": "CONFIRMADO_COMPLETO", "texto_del_kid": "Índice de referencia: MSCI World Index",
              "indice_morningstar": "MSCI World NR EUR", "kid_sha256": "a" * 64,
              "fecha_comprobacion": "2026-11-07", "metodo": indice_kid.METODO}
    ident = {"nombre": "Fondo de prueba", "tipo": "fondo", "indice_benchmark_oficial": "MSCI World NR EUR"}
    con = convierte({"isin": "LU0000000009", "identificacion": {**ident, "indice_benchmark_kid": bloque}})
    sin = convierte({"isin": "LU0000000009", "identificacion": ident})
    assert con["indice_benchmark_kid"] == bloque
    assert "indice_benchmark_kid" not in sin
    # Solo se añade: el índice que la plataforma sí lee sigue siendo el de Morningstar.
    assert con["classification_v2"]["official_benchmark"] == sin["classification_v2"]["official_benchmark"]         == "MSCI World NR EUR"


def test_un_nombre_de_una_palabra_necesita_frase_de_referencia():
    # El €STR suelto sale también en la comisión de rentabilidad o en los costes.
    costes = "Comisiones de rendimiento: un 15 % de la rentabilidad anual por encima del 100% ESTR."
    assert indice_kid.compara("Euro Short Term Rate", costes)["estado"] == "NO_CONFIRMADO"
    medido = "Deberá utilizarse el ESTR Overnight para comparar la rentabilidad del Fondo."
    assert indice_kid.compara("Overnight ESTR", medido)["estado"] == "CONFIRMADO_COMPLETO"


def test_el_indice_dicho_como_objetivo_de_rentabilidad_confirma():
    # Groupama Avenir Europe (LU0675297237): nombra el índice sin la palabra «índice».
    texto = ("El objetivo de gestión del producto es obtener una rentabilidad superior a la del "
             "MSCI EUROPE Small Cap, dividendos netos reinvertidos.")
    assert indice_kid.compara("MSCI Europe Small Cap NR EUR", texto)["estado"] == "CONFIRMADO_COMPLETO"


def test_un_compuesto_con_el_peso_detras_del_nombre_tambien_es_compuesto():
    # La frase real de CaixaBank Small & Mid Caps España (ES0138800034, KID de la CNMV), el único
    # compuesto de los 679 KID que el contador daba por CONFIRMADO_COMPLETO porque escribe el
    # porcentaje detrás del nombre. Con una fila del IBEX 35 habría publicado beta 0,6 contra un
    # índice que no es el suyo (decisión 27 del 07-11-2026).
    texto = ("Objetivos:La gestión toma como referencia la rentabilidad del índice IBEX Small Cap Net "
             "Return (IBEXSN) en un 30%, del IBEX Medium Cap Net Return (IBEXCN) en un 50% y del IBEX 35 "
             "Net Return (IBEXNR) en un 20%, únicamente a efectos informativos o comparativos.")
    r = indice_kid.compara("Ibex 35 TR EUR", texto)
    assert r["estado"] == "COMPUESTO"
    assert "en un 30%" in r["texto_del_kid"] and "en un 20%" in r["texto_del_kid"]


def test_un_solo_peso_detras_del_nombre_no_es_un_compuesto():
    # Una sola pieza es un índice entero («al 100 %» o sin más), no una mezcla.
    texto = ("La gestión toma como referencia la rentabilidad del índice IBEX 35 Net Return en un 100%, "
             "únicamente a efectos informativos.")
    assert indice_kid.compara("Ibex 35 NR EUR", texto)["estado"] == "CONFIRMADO_COMPLETO"
