# -*- coding: utf-8 -*-
"""Una sola regla para el signo de los costes del KID (decisión de Óscar, 17-10, 6.6).

PRIIPs admite costes de transacción negativos; entrada, salida, gestión y otros
costes corrientes y rendimiento no pueden serlo, así que un negativo ahí es un
error de lectura: se avisa y no se usa. Antes el texto pasaba a positivo los
negativos pequeños y las celdas los dejaban tal cual (revisión, ALTA-16b). El
signo cuenta también con el menos tipográfico pegado a la cifra (U+2212, U+2013).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
MENOS, RAYA = "−", "–"


def _kid(entrada="No cobramos comisión de entrada en este producto.",
         gestion="1,70 % del valor de su inversión por año.",
         operacion="0,133% del valor de su inversión al año.") -> str:
    texto = (FIX / "kid_es_caixabank_bolsa_espana_150.txt").read_text(encoding="utf-8")
    for viejo, nuevo in (("No cobramos comisión de entrada en este producto.", entrada),
                         ("1,70 % del valor de su inversión por año.", gestion),
                         ("0,133% del valor de su inversión al año.", operacion)):
        assert viejo in texto
        texto = texto.replace(viejo, nuevo, 1)
    return texto


@pytest.mark.parametrize("signo", ["-", MENOS, RAYA])
def test_un_coste_de_transaccion_negativo_se_respeta(signo):
    r = kid.parsea(_kid(operacion=f"{signo}0,02 % del valor de su inversión al año."), "ES0137878031")
    assert r["costes"]["transaccion_pct"] == -0.02
    assert r["costes"]["gestion_y_otros_pct"] == 1.7 and r["avisos"] == []


@pytest.mark.parametrize("signo", ["-", MENOS, RAYA])
def test_un_negativo_fuera_de_la_transaccion_es_un_error_de_lectura(signo):
    r = kid.parsea(_kid(entrada=f"{signo}0,05 % de lo que paga al entrar.",
                        gestion=f"{signo}1,70 % del valor de su inversión por año."), "ES0137878031")
    assert r["costes"]["entrada_pct"] is None            # antes: abs -> 0,05
    assert r["costes"]["gestion_y_otros_pct"] is None    # antes: -1,70 tal cual
    assert r["avisos"] == ["coste_negativo_descartado:entrada_pct=-0.05",
                           "coste_negativo_descartado:gestion_y_otros_pct=-1.7"]
    assert r["costes"]["transaccion_pct"] == 0.133


def test_una_raya_entre_dos_cifras_no_es_un_signo():
    r = kid.parsea(_kid(operacion=f"0,10{RAYA}0,20 % del valor de su inversión al año."), "ES0137878031")
    assert r["costes"]["transaccion_pct"] == 0.2
    m = kid.RE_PCT.search(f"letra{MENOS}0,3 %")
    assert kid._pct(m) == 0.3                             # pegado a una letra tampoco


def _pdf_de_costes(tmp_path, filas: list[tuple[str, str]]) -> Path:
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 60), "Documento de datos fundamentales", fontsize=9)
    page.insert_text((40, 120), "Composición de los costes", fontsize=10)
    y = 160
    for etiqueta, valor in filas:
        page.insert_text((40, y), etiqueta, fontsize=9)
        page.insert_text((320, y), valor, fontsize=9)
        y += 40
    ruta = tmp_path / "costes.pdf"
    doc.save(str(ruta))
    doc.close()
    return ruta


def test_las_celdas_aplican_la_misma_regla(tmp_path):
    # Con las fuentes base-14 de PyMuPDF el signo menos y la raya no se pueden
    # escribir (salen como «·»): aquí va el guion; el signo tipográfico usa la
    # misma RE_PCT y lo cubren las pruebas del texto.
    ruta = _pdf_de_costes(tmp_path, [("Costes de entrada", "-0,05 % de lo que paga"),
                                     ("Costes de salida", "0,00 %"),
                                     ("Costes de operación", "-0,02 % del valor")])
    avisos: list[str] = []
    celdas = kid.costes_por_celdas(ruta, "es", avisos)
    assert celdas["entrada_pct"] is None and celdas["transaccion_pct"] == -0.02
    assert celdas["salida_pct"] == 0.0
    assert avisos == ["coste_negativo_descartado:entrada_pct=-0.05"]
    r = kid.parsea_pdf(ruta)
    assert r["costes"]["entrada_pct"] is None and r["costes"]["transaccion_pct"] == -0.02
    assert "coste_negativo_descartado:entrada_pct=-0.05" in r["avisos"]


def test_normaliza_coste():
    assert kid._normaliza_coste("transaccion_pct", -0.02) == -0.02
    for clave in ("entrada_pct", "salida_pct", "gestion_y_otros_pct", "rendimiento_pct"):
        assert kid._normaliza_coste(clave, -0.01) is None
        assert kid._normaliza_coste(clave, 0.0) == 0.0 and kid._normaliza_coste(clave, None) is None


# --- Sexta pasada: MEN-8, MEN-9 y MEN-10 -----------------------------------------

def test_un_guion_pegado_a_la_etiqueta_no_es_signo():
    # MEN-8: la regla del signo se evaluaba sobre el trozo ya cortado, así que no
    # veía la etiqueta pegada delante.
    texto = _kid().replace("Costes de entrada\nNo cobramos", "Costes de entrada-0,30 % de lo que paga.\nNo cobramos", 1)
    r = kid.parsea(texto, "ES0137878031")
    assert r["costes"]["entrada_pct"] == 0.3 and r["avisos"] == []


@pytest.mark.parametrize("operacion,esperado", [
    ("0,10 \u20130,20 % del valor de su inversión al año.", 0.2),     # intervalo con espacio a un lado
    ("0,10\u20130,20 % del valor de su inversión al año.", 0.2),
    ("\u20120,02 % del valor de su inversión al año.", -0.02),        # raya de cifra
    ("\u20110,02 % del valor de su inversión al año.", -0.02),        # guion sin ruptura
    ("\uff0d0,02 % del valor de su inversión al año.", -0.02),        # menos de ancho completo
    ("\u20140,02 % del valor de su inversión al año.", 0.02),         # raya larga: no es signo
    ("\u2212 0,02 % del valor de su inversión al año.", 0.02),        # con espacio: separador
])
def test_que_cuenta_como_signo(operacion, esperado):
    r = kid.parsea(_kid(operacion=operacion), "ES0137878031")
    assert r["costes"]["transaccion_pct"] == esperado


def test_en_las_celdas_tampoco_cuenta_un_guion_pegado_a_la_etiqueta(tmp_path):
    ruta = _pdf_de_costes(tmp_path, [("Costes de entrada-0,30 % de lo que paga", ""),
                                     ("Costes de operación", "0,10 -0,20 % del valor")])
    celdas = kid.costes_por_celdas(ruta, "es", [])
    assert celdas["entrada_pct"] == 0.3 and celdas["transaccion_pct"] == 0.2


def test_el_mismo_negativo_se_avisa_una_sola_vez(tmp_path):
    # MEN-10: el texto y las celdas leían el mismo negativo y dejaban dos avisos.
    ruta = _pdf_de_costes(tmp_path, [("Costes de entrada", "-0,05 % de lo que paga"),
                                     ("Costes de salida", "0,00 %")])
    r = kid.parsea_pdf(ruta)
    assert r["avisos"].count("coste_negativo_descartado:entrada_pct=-0.05") == 1
