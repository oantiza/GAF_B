# -*- coding: utf-8 -*-
"""La tabla de costes del KID se lee por filas, como se ve (decisión 43 de Óscar, 05-11-2026).

Manda el KID, y por eso «KID» no se puede escribir junto a una cifra que no salga de él. Medido
sobre los 705 KID del canónico, cada caso de aquí es un fondo real leído mal: PIMCO salía con un
0 % de entrada donde su KID dice «492 EUR, la cantidad máxima», y era el 0 % frente al 5 % del
proveedor por el que se le preguntó a Óscar; Santalucía con 0 % de coste corriente donde dice
2,07 %; Xtrackers con un 82 % de costes de operación donde dice 0,01 %.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402


def _pdf(tmp_path, trozos, nombre="kid.pdf"):
    """Un PDF con cada trozo (x, y, texto) en su sitio. El orden de la lista es el del flujo del fichero."""
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    for x, y, texto in trozos:
        page.insert_text((x, y), texto, fontsize=9)
    ruta = tmp_path / nombre
    doc.save(str(ruta))
    doc.close()
    return ruta


CABECERA = [(40, 40, "Documento de datos fundamentales"), (40, 70, "Composición de los costes"),
            (40, 90, "Costes únicos de entrada o salida"), (420, 90, "En caso de salida después de 1 año")]
FILAS_NORMALES = [(40, 330, "Comisiones de gestión y otros"), (150, 330, "1,39 % del valor de su inversión al año."), (420, 330, "139 EUR"),
                  (40, 370, "Costes de operación"), (150, 370, "0,21 % del valor de su inversión al año."), (420, 370, "21 EUR")]


def test_un_kid_que_solo_da_euros_no_es_un_cero(tmp_path):
    # PIMCO: «0 % en el KID y 5 % en Morningstar» era una mala lectura nuestra.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de entrada"), (150, 112, "La incidencia de los costes que usted pagará al realizar su inversión."),
        (150, 122, "Se trata de la cantidad máxima que se le cobrará, y podría pagar menos."), (420, 120, "492 EUR"),
        (40, 160, "Costes de salida"), (150, 160, "No cobramos una comisión de salida por este producto."), (420, 160, "0 EUR"),
    ] + FILAS_NORMALES)
    avisos = []
    celdas = kid.costes_por_celdas(ruta, "es", avisos)
    assert celdas["entrada_pct"] is None
    assert "coste_solo_en_importe:entrada_pct" in avisos
    assert celdas["salida_pct"] == 0.0
    assert celdas["gestion_y_otros_pct"] == 1.39 and celdas["transaccion_pct"] == 0.21


def test_la_entrada_es_el_maximo_aunque_la_frase_empiece_por_no_cobramos(tmp_path):
    # Pictet, con «Hasta 500 EUR» en la columna.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de entrada"), (150, 116, "Pictet no cobra gastos de entrada, si bien la persona que le"),
        (150, 126, "venda el producto podría cobrarle hasta 5,00 %."), (420, 120, "Hasta 500 EUR"),
    ] + FILAS_NORMALES)
    assert kid.costes_por_celdas(ruta, "es", [])["entrada_pct"] == 5.0


def test_un_cero_explicito_es_un_cero(tmp_path):
    # BNY Mellon: el KID lo dice con todas las letras, aunque el proveedor diga un 5 %.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de entrada"), (150, 120, "0,00 %, no le cobraremos una comisión de entrada por este fondo."), (420, 120, "0 EUR"),
    ] + FILAS_NORMALES)
    assert kid.costes_por_celdas(ruta, "es", [])["entrada_pct"] == 0.0


def test_la_salida_no_es_la_entrada(tmp_path):
    # Gestión Value: la frase de la fila de al lado asoma en la fila de entrada.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de entrada"), (150, 120, "No hay comisión de entrada para este producto."), (420, 120, "0 €"),
        (40, 132, "Costes de salida"), (150, 132, "La comisión de salida es de 2,00 %."), (420, 132, "0 €"),
    ] + FILAS_NORMALES)
    celdas = kid.costes_por_celdas(ruta, "es", [])
    assert celdas["entrada_pct"] == 0.0 and celdas["salida_pct"] == 2.0


def test_el_titulo_del_grupo_no_es_la_fila_de_gestion(tmp_path):
    # Santalucía: «Costes corrientes (detraídos cada año)» se leía como la fila, y su vecina
    # de arriba decía «no cobramos»: 0 % de coste corriente en un fondo que cobra 2,07 %.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de salida"), (150, 120, "No cobramos una comisión de salida por este producto."), (420, 120, "0 EUR"),
        (40, 150, "Costes corrientes (detraídos cada año)"),
        (40, 180, "Comisiones de gestión y otros"), (150, 190, "2.07% del valor de su inversión al año. Se trata de una estimación"),
        (40, 200, "costes administrativos de"), (420, 200, "207 EUR"), (150, 210, "basada en los costes del próximo año."),
        (40, 220, "funcionamiento"),
        (150, 250, "0.16% del valor de su inversión al año. Se trata de una estimación"),
        (150, 260, "basada en los costes que incurrimos al comprar y vender las"),
        (40, 270, "Costes de operación"), (420, 270, "16 EUR"),
        (150, 280, "inversiones subyacentes del producto."),
    ])
    celdas = kid.costes_por_celdas(ruta, "es", [])
    assert celdas["gestion_y_otros_pct"] == 2.07 and celdas["transaccion_pct"] == 0.16


def test_una_fila_sin_porcentaje_no_coge_el_de_la_siguiente(tmp_path):
    # Banca March: la fila de operación solo da euros, y el 9 % es de la comisión de rendimiento.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Costes de operación"), (150, 120, "Cantidad monetaria que se le cobrará de su inversión cada año."), (420, 120, "3 EUR"),
        (40, 170, "Comisiones de rendimiento"), (150, 170, "Se le cobrará un 9% de comisión sobre resultados."), (420, 170, "11 EUR"),
    ])
    assert kid.costes_por_celdas(ruta, "es", [])["transaccion_pct"] is None
    # Y el texto plano, que no ve columnas, no la rellena con esa misma cifra.
    assert kid.parsea_pdf(ruta)["costes"]["transaccion_pct"] is None


def test_una_cifra_de_otro_plazo_no_es_anual(tmp_path):
    # Mutuafondo Corto Plazo, 3 meses de periodo recomendado: su coste corriente anual es 0,53 %.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Comisiones de gestión y otros"), (150, 120, "0,14% del valor de su inversión al final del periodo."), (420, 120, "15 €"),
        (40, 170, "Costes de operación"), (150, 170, "0,03% del valor de su inversión por 3 meses."), (420, 170, "3 €"),
    ])
    avisos = []
    celdas = kid.costes_por_celdas(ruta, "es", avisos)
    assert celdas["gestion_y_otros_pct"] is None and celdas["transaccion_pct"] is None
    assert "coste_no_anual:gestion_y_otros_pct" in avisos and "coste_no_anual:transaccion_pct" in avisos


def test_el_orden_del_fichero_no_es_el_de_la_pagina(tmp_path):
    # Acatis: el título de la tabla viene en el fichero después de sus filas, y de ahí se leía
    # como coste de operación el 20 % de la comisión de rendimiento.
    filas = [(40, 120, "Los costes de operación"), (150, 120, "0,2% del valor de su inversión al año."), (420, 120, "24 EUR"),
             (40, 170, "Comisiones en función de la rentabilidad"), (150, 170, "Hasta el 20% del rendimiento generado."), (420, 170, "51 EUR")]
    ruta = _pdf(tmp_path, filas + [(40, 40, "Documento de datos fundamentales"), (40, 70, "Composición de los costes")])
    assert kid.costes_por_celdas(ruta, "es", [])["transaccion_pct"] == 0.2


def test_una_mencion_en_la_prosa_no_es_la_fila(tmp_path):
    # BlackRock: la fila de gestión cita «Costes de operación» entre comillas antes de la fila de verdad.
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Comisiones de gestión y otros"), (150, 116, "1.01% del valor de su inversión al año. Aquí se incluye cualquier coste,"),
        (150, 126, "con la excepción de los que se incluyen en"), (150, 136, "«Costes de operación»."), (420, 120, "101 EUR"),
        (40, 170, "Costes de operación"), (150, 170, "0.40% del valor de su inversión al año."), (420, 170, "40 EUR"),
    ])
    celdas = kid.costes_por_celdas(ruta, "es", [])
    assert celdas["gestion_y_otros_pct"] == 1.01 and celdas["transaccion_pct"] == 0.4


def test_sin_titulo_de_tabla_no_vale_una_mencion_de_antes(tmp_path):
    # Xtrackers no titula la tabla, y su descripción habla de «costes de transacción»:
    # de ahí salía un 82 % donde el KID dice 0,01 %.
    ruta = _pdf(tmp_path, [
        (40, 40, "Documento de datos fundamentales"),
        (40, 70, "El fondo pondera un 82 % en el índice. Los costes de transacción y los impuestos pueden afectar."),
        (40, 120, "Costes de entrada"), (150, 120, "No cobramos comisión de entrada."), (420, 120, "0 USD"),
        (40, 170, "Costes de operación"), (150, 170, "0,01 % del valor de su inversión al año."), (420, 170, "1 USD"),
    ])
    assert kid.costes_por_celdas(ruta, "es", [])["transaccion_pct"] == 0.01


def test_la_etiqueta_partida_en_dos_lineas(tmp_path):
    ruta = _pdf(tmp_path, CABECERA + [
        (40, 120, "Comisiones de gestión y"), (150, 125, "1,42 % del valor de su inversión al año."), (420, 125, "142 €"),
        (40, 130, "otros costes administrativos"),
        (40, 140, "o de funcionamiento"),
        (40, 170, "Costes de operación"), (150, 170, "0,05 % del valor de su inversión al año."), (420, 170, "5 €"),
    ])
    celdas = kid.costes_por_celdas(ruta, "es", [])
    assert celdas["gestion_y_otros_pct"] == 1.42 and celdas["transaccion_pct"] == 0.05


def test_la_cifra_delante_de_la_etiqueta_en_la_misma_linea(tmp_path):
    # Heptagon: «0,1% Costes de operación de cartera».
    ruta = _pdf(tmp_path, CABECERA + [(40, 120, "0,1% Costes de operación de cartera")])
    assert kid.costes_por_celdas(ruta, "es", [])["transaccion_pct"] == 0.1
