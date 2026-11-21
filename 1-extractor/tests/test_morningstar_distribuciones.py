# -*- coding: utf-8 -*-
"""El historial de repartos del proveedor, que no se guardaba para nadie.

El bloque `distribuciones.historial` existía en `morningstar._mapea` desde
siempre y no escribía nada, por tres defectos a la vez: buscaba la lista en
tres claves que no existen, tomaba como importe el valor liquidativo del día
del reparto, y guardaba la fecha cruda.

Importa porque es la pieza que decide si se pueden calcular métricas propias.
La serie de valor liquidativo de una clase que reparte baja el día del pago, y
esa caída no es mercado: es dinero que salió al partícipe. Sin el historial hay
que renunciar a calcular (o fiarse del nombre de la clase, que es lo que se
hacía); con él se reconstruye la serie de retorno total.

La forma del payload es la de
`cache/raw_morningstar_lt/IE0004868828/sal_distribution.json`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import morningstar as ms  # noqa: E402
from fetchers import vl_fondos  # noqa: E402


def _pago(fecha, total, vl, renta=None):
    return {"distributionDate": fecha, "distributionNav": vl, "income": renta if renta is not None else total,
            "capGainShortTerm": 0.0, "capGainLongTerm": 0.0, "returnOfCapital": 0.0,
            "total": total, "interestIncome": None, "foreignIncome": None,
            "capitalGains": None, "canadianDividend": None}


SAL = {
    "distribution": [_pago("2026-05-01T05:00:00.000", 4.64309, 244.93),
                     _pago("2025-05-01T05:00:00.000", 4.49204, 210.93),
                     _pago("2024-05-01T05:00:00.000", 2.55038, 210.47)],
    "baseCurrencyId": "EUR",
    "template": "OE_USA_FIXEDINCOME",
}

VACIO = {"distribution": [], "baseCurrencyId": "EUR", "template": "OE_USA_FIXEDINCOME"}


def test_el_historial_se_guarda_con_fecha_iso_e_importe_del_reparto():
    out = {}
    ms._mapea(out, {"distribution": SAL})
    hist = out["distribuciones"]["historial"]
    assert len(hist) == 3
    # Ordenado por fecha, de lo más viejo a lo más nuevo.
    assert [r["fecha"] for r in hist] == ["2024-05-01", "2025-05-01", "2026-05-01"]
    # El importe es el reparto (4,64), NO el valor liquidativo de ese día (244,93).
    ultimo = hist[-1]
    assert ultimo["importe_por_participacion"] == 4.64309
    assert ultimo["vl_en_la_fecha"] == 244.93
    assert out["distribuciones"]["divisa"] == "EUR"


def test_el_valor_liquidativo_nunca_se_cuela_como_importe():
    # Era el segundo defecto: `distributionNAV` como importe habría escrito
    # 244,93 de reparto por participación donde el reparto fue 4,64.
    out = {}
    ms._mapea(out, {"distribution": SAL})
    importes = [r["importe_por_participacion"] for r in out["distribuciones"]["historial"]]
    assert 244.93 not in importes
    assert max(importes) < 10


def test_una_lista_vacia_deja_la_marca_de_consultado_y_ningun_historial():
    # Es la diferencia entre "el proveedor dice que no hay repartos" y "no se ha
    # preguntado". Sin la marca, las dos cosas se ven iguales.
    out = {}
    ms._mapea(out, {"distribution": VACIO})
    assert out["distribuciones"]["historial_consultado"] is True
    assert "historial" not in out["distribuciones"]


def test_sin_respuesta_del_endpoint_no_hay_marca():
    out = {}
    ms._mapea(out, {})
    assert "historial_consultado" not in (out.get("distribuciones") or {})


def test_un_pago_sin_fecha_o_sin_importe_no_entra():
    out = {}
    ms._mapea(out, {"distribution": {"distribution": [
        {"distributionDate": None, "total": 1.0},
        {"distributionDate": "2026-01-02T00:00:00.000", "total": None},
        {"distributionDate": "2026-03-04T00:00:00.000", "total": 0.5},
    ]}})
    hist = out["distribuciones"]["historial"]
    assert [r["fecha"] for r in hist] == ["2026-03-04"]


def test_el_desglose_de_plusvalias_se_suma_cuando_viene_por_tramos():
    out = {}
    pago = _pago("2026-02-02T00:00:00.000", 3.0, 100.0, renta=1.0)
    pago["capGainShortTerm"] = 0.5
    pago["capGainLongTerm"] = 1.5
    ms._mapea(out, {"distribution": {"distribution": [pago]}})
    registro = out["distribuciones"]["historial"][0]
    assert registro["renta"] == 1.0
    assert registro["plusvalias"] == 2.0


class TestLaCascadaDeLaPolitica:
    """El historial entra en `politica` por delante del nombre."""

    def test_con_repartos_registrados_la_clase_reparte(self):
        previo = {"morningstar_lt": {"distribuciones": {"historial": [{"fecha": "2026-05-01",
                                                                      "importe_por_participacion": 4.6}]},
                                     "identificacion": {"nombre": "Un Fondo Acc EUR"}}}
        # El nombre dice acumulación y el historial dice que reparte: gana el historial, salvo que el KID
        # de la clase diga otra cosa (decisión 78: IE00BD5CTX77, que antes estaba aquí, es de esas).
        assert vl_fondos.politica("LU0000000000", previo) == (False, "historial_repartos")

    def test_consultado_y_vacio_vale_mas_que_el_nombre(self):
        previo = {"morningstar_lt": {"distribuciones": {"historial_consultado": True},
                                     "identificacion": {"nombre": "Un Fondo sin marca"}}}
        assert vl_fondos.politica("LU0000000001", previo) == (True, "sin_repartos_del_proveedor")

    def test_pero_no_contradice_un_nombre_que_dice_reparto(self):
        previo = {"morningstar_lt": {"distribuciones": {"historial_consultado": True},
                                     "identificacion": {"nombre": "Un Fondo Dist EUR"}}}
        assert vl_fondos.politica("LU0000000002", previo) == (False, "nombre_reparto")

    def test_el_registro_oficial_sigue_mandando_sobre_todo(self):
        previo = {"amf_geco": {"identificacion": {"politica_distribucion": "distribucion"}},
                  "morningstar_lt": {"distribuciones": {"historial_consultado": True}}}
        assert vl_fondos.politica("FR0000000001", previo) == (False, "politica_distribucion")

    def test_sustituye_al_supuesto_de_los_fondos_espanoles(self):
        # Antes un ES sin marca en el nombre caia en `es_sin_reparto`, un supuesto
        # por jurisdiccion. Ahora, si el proveedor contesto, manda el proveedor.
        sin_nada = vl_fondos.politica("ES0000000001", {})
        assert sin_nada == (True, "es_sin_reparto")
        con_proveedor = vl_fondos.politica(
            "ES0000000001", {"ms": {"distribuciones": {"historial_consultado": True}}})
        assert con_proveedor == (True, "sin_repartos_del_proveedor")

    def test_sin_nada_sigue_sin_saberse(self):
        assert vl_fondos.politica("LU0000000003", {}) == (None, "politica_desconocida")


class TestElOrdenDeLaPasada:
    """El defecto que el sondeo del 01-11 destapo: la politica llegaba tarde.

    `vl_eodhd` corre ANTES de `morningstar_lt`, asi que cuando `politica` mira
    `previo` el historial de ESTA pasada todavia no esta en ninguna ficha: solo
    estaria en `_anterior`, es decir, a una pasada de retraso. Medido con cinco
    fondos reales, DE0008490962 trajo cinco repartos y aun asi se decidio por el
    nombre y se le calcularon metricas recortadas.

    Se arregla leyendo la respuesta guardada del proveedor, que si esta a tiempo.
    """

    def _cache(self, base, isin, payload):
        import json
        d = base / "cache" / "raw_morningstar_lt" / isin
        d.mkdir(parents=True)
        (d / "sal_distribution.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_los_repartos_de_esta_pasada_ganan_al_nombre(self, tmp_path):
        # El caso real: nombre de acumulacion, cinco pagos en la caché.
        self._cache(tmp_path, "DE0008490962", SAL)
        previo = {"morningstar_lt": {"identificacion": {"nombre": "Un Fondo Acc EUR"}}}
        assert vl_fondos.politica("DE0008490962", previo, tmp_path) == (False, "historial_repartos")

    def test_sin_la_cache_el_mismo_fondo_se_decidia_por_el_nombre(self, tmp_path):
        # Deja escrito el comportamiento viejo, para que se vea qué cambió.
        previo = {"morningstar_lt": {"identificacion": {"nombre": "Un Fondo Acc EUR"}}}
        assert vl_fondos.politica("DE0008490962", previo, tmp_path) == (True, "nombre_acumulacion")

    def test_una_lista_vacia_en_cache_vale_de_evidencia_de_acumulacion(self, tmp_path):
        self._cache(tmp_path, "LU0000000010", VACIO)
        assert vl_fondos.politica("LU0000000010", {}, tmp_path) == (True, "sin_repartos_del_proveedor")

    def test_pero_no_contradice_un_nombre_que_dice_reparto(self, tmp_path):
        self._cache(tmp_path, "LU0000000011", VACIO)
        previo = {"morningstar_lt": {"identificacion": {"nombre": "Un Fondo Dist EUR"}}}
        assert vl_fondos.politica("LU0000000011", previo, tmp_path) == (False, "nombre_reparto")

    def test_un_fichero_ausente_no_es_una_lista_vacia(self, tmp_path):
        # Si no se pregunto, no se sabe. Confundirlo con "no reparte" es
        # exactamente el supuesto que esta cadena viene a quitar.
        assert vl_fondos.politica("LU0000000012", {}, tmp_path) == (None, "politica_desconocida")

    def test_un_json_roto_o_sin_la_clave_no_decide_nada(self, tmp_path):
        d = tmp_path / "cache" / "raw_morningstar_lt" / "LU0000000013"
        d.mkdir(parents=True)
        (d / "sal_distribution.json").write_text("{no es json", encoding="utf-8")
        assert vl_fondos.politica("LU0000000013", {}, tmp_path) == (None, "politica_desconocida")
        self._cache(tmp_path, "LU0000000014", {"baseCurrencyId": "EUR"})
        assert vl_fondos.politica("LU0000000014", {}, tmp_path) == (None, "politica_desconocida")

    def test_sin_base_no_mira_la_cache_y_no_se_cae(self, tmp_path):
        assert vl_fondos.politica("LU0000000015", {}, None) == (None, "politica_desconocida")

    def test_el_registro_oficial_sigue_mandando_sobre_la_cache(self, tmp_path):
        self._cache(tmp_path, "FR0000000010", SAL)
        previo = {"amf_geco": {"identificacion": {"politica_distribucion": "acumulacion"}}}
        assert vl_fondos.politica("FR0000000010", previo, tmp_path) == (True, "politica_acumulacion")


def test_vl_eodhd_corre_detras_de_morningstar():
    """El orden de la pasada es parte del arreglo, no una casualidad.

    `vl_fondos` decide si la clase reparte ANTES de calcular metricas de la
    serie de VL, y la evidencia mas fuerte de que reparte es el historial de
    pagos de `morningstar_lt`. Si alguien devuelve `vl_eodhd` delante, esa
    evidencia vuelve a llegar a una pasada de retraso y las metricas vuelven a
    calcularse sobre series contaminadas por el reparto, sin que nada avise.
    """
    from core.adquisicion import registro
    por_id = {a.id: a.orden for a in registro.ADAPTADORES}
    assert por_id["vl_eodhd"] > por_id["morningstar_lt"]
    assert por_id["vl_eodhd"] > por_id["morningstar"]
