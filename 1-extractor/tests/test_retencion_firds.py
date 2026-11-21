# -*- coding: utf-8 -*-
"""La identidad FIRDS se retiene con plazo cuando un ISIN sale del índice (decisión A-170).

Óscar, 16-11-2026, ante EXT-6 de la auditoría integral: es la opción C de la decisión 57. Hasta
hoy, si el índice dejaba de traer un ISIN, la ficha se reescribía sin sus diez campos de FIRDS y
solo lo decía el registro de la pasada.

Las fechas son cuentas a mano: del 07-11-2026 al 16-11-2026 van 9 días, y 180 días después del
07-11-2026 es el 06-05-2027 (23 de noviembre, 31, 31, 28, 31, 30 y 6 de mayo: 180).
"""
import copy
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adaptador_bdb import identidad_firds  # noqa: E402
from core.adquisicion import retencion  # noqa: E402
from core.pasada import GuardaFirds  # noqa: E402

VISTO = "2026-11-07"
HOY = dt.date(2026, 11, 16)
FULINS = "esma_firds:fulins"
RETENIDA = f"retenido:{FULINS}@{VISTO}"

IDENTIDAD = {
    "nombre_oficial_firds": "Erste Group Bank AG", "nombre_corto_firds": "ERSTE GRP/SHS",
    "cfi": "ESVUFB", "cfi_tipo": "ACCION", "divisa_nominal_firds": "EUR",
    "lei_emisor": "PQOH26KWDF7CG10L6792", "autoridad_competente_firds": "AT",
    "mercados_ue": [{"mic": "XWBO", "admision": "1997-12-04"}, {"mic": "XETA", "primera_negociacion": "2010-01-04"}],
}
#: Las nueve rutas con valor; `baja_en_todos_firds` es None en un valor que cotiza y no hay nada que retener.
RUTAS = [f"identificacion.{k}" for k in IDENTIDAD] + ["meta.firds_visto"]


def _con_firds(tipo: str = "fondo", etiqueta: str = FULINS) -> dict:
    return {"identificacion": {"tipo": tipo, "nombre": "Uno", **copy.deepcopy(IDENTIDAD)},
            "meta": {"actualizado": "2026-11-08T07:00:00+00:00", "firds_visto": VISTO,
                     "procedencia": {r: etiqueta for r in RUTAS}}}


def _sin_firds(tipo: str = "fondo", **ident) -> dict:
    return {"identificacion": {"tipo": tipo, "nombre": "Uno", **ident},
            "meta": {"actualizado": "2026-11-16T07:00:00+00:00", "procedencia": {}}}


def test_un_fondo_que_sale_del_indice_conserva_su_identidad_marcada_y_fechada():
    final = _sin_firds()
    resumen = retencion.aplica(final, _con_firds(), HOY)

    for campo, valor in IDENTIDAD.items():
        assert final["identificacion"][campo] == valor, campo
    # `firds_visto` sigue diciendo el día del índice en que era verdad, no el de hoy.
    assert final["meta"]["firds_visto"] == VISTO
    assert {r: final["meta"]["procedencia"][r] for r in RUTAS} == {r: RETENIDA for r in RUTAS}
    assert resumen["retenidos"] == [{"ruta": "identidad_firds", "fecha": VISTO, "dias": 9,
                                     "caduca": "2027-05-06", "fuente": [FULINS]}]
    assert retencion.avisos(final) == ["dato_retenido"]
    assert retencion.firds_retenida_desde(final) == VISTO


def test_una_accion_tambien():
    # Las acciones van por su propia retención (fundamentales e identidad de Yahoo): la de FIRDS es la misma.
    final = _sin_firds("accion")
    resumen = retencion.aplica(final, _con_firds("accion"), HOY)
    assert final["identificacion"]["lei_emisor"] == "PQOH26KWDF7CG10L6792"
    assert final["meta"]["firds_visto"] == VISTO
    assert final["meta"]["procedencia"]["identificacion.cfi"] == RETENIDA
    assert [x["ruta"] for x in resumen["retenidos"]] == ["identidad_firds"]


def test_el_plazo_son_180_dias_desde_que_el_indice_lo_vio():
    assert retencion.MAX_DIAS_FIRDS == 180
    # El día 180 (06-05-2027) todavía la conserva.
    final = _sin_firds()
    retencion.aplica(final, _con_firds(), dt.date(2027, 5, 6))
    assert final["meta"]["firds_visto"] == VISTO and final["identificacion"]["cfi"] == "ESVUFB"
    # El 181 ya no: la ficha se queda sin identidad FIRDS y dice por qué.
    final = _sin_firds()
    resumen = retencion.aplica(final, _con_firds(), dt.date(2027, 5, 7))
    assert "firds_visto" not in final["meta"]
    assert not any(k in final["identificacion"] for k in IDENTIDAD)
    assert resumen["descartados"] == [{"ruta": "identidad_firds", "fecha": VISTO,
                                       "motivo": "antiguedad_181d_supera_180d"}]
    assert "retenidos" not in resumen


def test_lo_ya_retenido_conserva_su_fecha_y_caduca_solo():
    """La antigüedad se cuenta desde que el índice lo vio, no desde la última pasada: una ficha que
    ya venía retenida no estrena fecha en cada pasada."""
    anterior = _con_firds(etiqueta=RETENIDA)
    final = _sin_firds()
    resumen = retencion.aplica(final, anterior, dt.date(2027, 2, 1))
    assert final["meta"]["procedencia"]["meta.firds_visto"] == RETENIDA
    assert resumen["retenidos"][0]["fecha"] == VISTO and resumen["retenidos"][0]["dias"] == 86
    final = _sin_firds()
    retencion.aplica(final, anterior, dt.date(2027, 5, 7))
    assert "firds_visto" not in final["meta"]


def test_si_la_pasada_trae_firds_no_se_retiene_nada():
    final = _con_firds()
    final["meta"]["firds_visto"] = "2026-11-14"
    final["identificacion"]["nombre_corto_firds"] = "ERSTE GROUP"
    resumen = retencion.aplica(final, _con_firds(), HOY)
    assert final["meta"]["firds_visto"] == "2026-11-14"
    assert final["identificacion"]["nombre_corto_firds"] == "ERSTE GROUP"
    assert final["meta"]["procedencia"]["identificacion.cfi"] == FULINS
    assert resumen == {} and "retencion" not in final["meta"]


def test_el_cfi_de_otra_fuente_no_se_pisa_ni_se_retiene_como_de_firds():
    # La pasada trae el CFI de la ficha de la CNMV: se queda el nuevo; lo demás de FIRDS se retiene.
    final = _sin_firds(cfi="CIOGLU")
    final["meta"]["procedencia"]["identificacion.cfi"] = "cnmv_ficha:ancv"
    retencion.aplica(final, _con_firds(), HOY)
    assert final["identificacion"]["cfi"] == "CIOGLU"
    assert final["meta"]["procedencia"]["identificacion.cfi"] == "cnmv_ficha:ancv"
    assert final["identificacion"]["lei_emisor"] == "PQOH26KWDF7CG10L6792"

    # Y al revés: un CFI que en la ficha anterior era de la CNMV no entra por la regla de FIRDS.
    anterior = _con_firds()
    anterior["meta"]["procedencia"]["identificacion.cfi"] = "cnmv_ficha:ancv"
    final = _sin_firds()
    retencion.aplica(final, anterior, HOY)
    assert "cfi" not in final["identificacion"]
    assert final["identificacion"]["cfi_tipo"] == "ACCION"


def test_quien_nunca_tuvo_firds_no_gana_nada():
    final = _sin_firds()
    assert retencion.aplica(final, _sin_firds(), HOY) == {}
    assert "firds_visto" not in final["meta"]


def test_el_canonico_lleva_la_identidad_retenida_y_dice_desde_cuando():
    final = _sin_firds()
    retencion.aplica(final, _con_firds(), HOY)
    bloque = identidad_firds(final)
    # El CFI sigue saliendo: su hoja viene retenida, pero la puso FIRDS.
    assert (bloque["cfi"], bloque["cfi_tipo"], bloque["lei_emisor"]) == ("ESVUFB", "ACCION", "PQOH26KWDF7CG10L6792")
    assert bloque["visto"] == VISTO and bloque["retenida_desde"] == VISTO
    assert [m["mic"] for m in bloque["mercados"]] == ["XWBO", "XETA"]
    # Y una identidad de esta pasada no lleva la marca.
    assert "retenida_desde" not in identidad_firds(_con_firds())


def test_el_aviso_de_la_pasada_ya_no_dice_que_se_pierde():
    aviso = GuardaFirds.aviso_de_desaparecido("AT0000652011")
    assert aviso == ("AT0000652011 tenía identidad FIRDS y el índice ya no lo trae: la ficha conserva la "
                     "última conocida, marcada como retenida, hasta 180 días desde que se vio")
