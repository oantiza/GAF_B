# -*- coding: utf-8 -*-
"""La CAM no es candidata a acción, por la regla general y no por su ISIN.

Encargo «identidad» del 07-11-2026, pieza 2. Las cuotas participativas de la CAM
(`ES0114400007`) figuran en FIRDS vigentes en XMAD, admitidas el 23-07-2008 y sin fecha de
baja, aunque no tienen precio en ninguna fuente. Lo que las deja fuera de `python main.py
universo` es su CFI, `EMXXXR`: el grupo `EM` es «otros» en ISO 10962, no una participación en
el capital, y `GRUPOS_ACCION` no lo incluye.

Medido el 07-11-2026 sobre el índice del 31-10 con los deltas hasta el 06-11, en los centros
por defecto: de 1.740 instrumentos de la categoría E vigentes, la regla deja fuera 24 `EM` y 335
`EY` (certificados y ETC). La CAM es el único `EM` de XMAD, y la única acción de
`config/fondos.csv` cuyo CFI no es de acción.

Lo que esta regla NO hace: decir que algo dejó de negociarse. FIRDS no publica la fecha de la
última negociación, solo admisión, primera negociación y baja, y la CAM no tiene baja. Por eso
la CAM sale de los candidatos por lo que **es**, no por cuándo cotizó.
"""
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from fetchers import esma_firds  # noqa: E402

CAM = ("ES0114400007", "CUOTAS PARTICIPATIVAS DE CAJA DE AHORROS DEL MEDITERRANEO", "EMXXXR",
       "959800UYJM40XUGVGG78", "2008-07-23")
AENA = ("ES0105046017", "AENA SME ORD SHS", "ESVUFB", "959800R7QMXKF0NFMT29", "2025-06-19")


def _indice(tmp_path):
    con = esma_firds.abre(tmp_path / "firds.sqlite")
    for isin, nombre, cfi, lei, admision in (CAM, AENA):
        con.execute("INSERT INTO instrumentos VALUES (?,?,?,?,?,?,?,?,?)",
                    (isin, nombre, nombre[:12], cfi, "ACCION", "EUR", lei, "ES", "2026-10-31"))
        con.execute("INSERT INTO mercados VALUES (?,?,?,?,?,?,?)",
                    (isin, "XMAD", admision, None, admision, None, "2026-10-31"))
    con.commit()
    return con


def test_el_cfi_de_la_cam_no_es_de_accion():
    assert esma_firds.cfi_tipo("EMXXXR") == "OTRO"
    assert esma_firds.cfi_tipo("ESVUFB") == "ACCION"


def test_la_cam_no_sale_entre_las_acciones_candidatas(tmp_path):
    """Aunque el índice guardara 'ACCION' para ella: el tipo se deduce al leer, del CFI."""
    con = _indice(tmp_path)
    try:
        isins = [f["isin"] for f in esma_firds.candidatos(con, ("XMAD",), ("ACCION",))]
    finally:
        con.close()
    assert isins == ["ES0105046017"]


def test_si_sale_cuando_se_piden_los_otros(tmp_path):
    """No se esconde: quien pida el tipo OTRO la ve, con su CFI."""
    con = _indice(tmp_path)
    try:
        filas = esma_firds.candidatos(con, ("XMAD",), ("OTRO",))
    finally:
        con.close()
    assert [(f["isin"], f["cfi"]) for f in filas] == [("ES0114400007", "EMXXXR")]
