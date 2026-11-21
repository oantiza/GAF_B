# -*- coding: utf-8 -*-
"""La bolsa que se perdia porque Morningstar la parte en dos.

`sal_allocationMap` devuelve SEIS claves que suman 100: `AssetAllocCash`,
`AssetAllocBond`, `AssetAllocUSEquity`, `AssetAllocNonUSEquity`,
`AssetAllocOther` y `AssetAllocNotClassified`.

El mapeo las traducia por subcadena a seis clases espanolas y guardaba
`candidatos[clase] = datos`, un dict por clase. Las dos claves de bolsa caen las
dos en `rv`, asi que la segunda pisaba a la primera y una mitad entera se
tiraba. Medido el 01-11-2026 sobre las 380 respuestas en cache: las 380 traen
las dos claves, en 219 las dos son distintas de cero, y lo tirado tenia una
mediana de 39,3 puntos y un maximo de 312,76. DE0008490962 figuraba con 0,03 %
de bolsa teniendo 99,02 %.

Y casi nunca se veia, porque al perder masa la suma se salia de la banda de
80-120 y la guarda no pisaba el valor bueno del snapshot. Solo mordia cuando el
estropicio era lo bastante pequeno para parecer plausible: asi llegaron 72
fondos a la maestra con un reparto que no suma 1, y 50 fichas con el porcentaje
de bolsa mal por una mediana de 6,7 puntos.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import morningstar as ms  # noqa: E402


def _clase(neto, largo=None, corto=None):
    d = {"netAllocation": neto}
    if largo is not None:
        d["longAllocation"] = largo
    if corto is not None:
        d["shortAllocation"] = corto
    return d


# La forma real de cache/raw_morningstar_lt/ES0138217031/sal_allocationMap.json
REAL = {
    "allocationMap": {
        "AssetAllocCash": _clase(17.33240),
        "AssetAllocNotClassified": _clase(0.0),
        "AssetAllocNonUSEquity": _clase(8.36669),
        "AssetAllocOther": _clase(0.00000),
        "AssetAllocUSEquity": _clase(0.23663),
        "AssetAllocBond": _clase(74.06428),
    }
}


def _asignacion(payload):
    out = {}
    ms._mapea(out, {"allocationMap": payload})
    return ((out.get("cartera") or {}).get("asignacion_activos")) or {}


def test_las_dos_mitades_de_la_bolsa_se_SUMAN():
    asg = _asignacion(REAL)
    # 0,23663 + 8,36669. Antes se guardaba 0,23663 y se tiraba el 8,37.
    assert asg["rv"]["neto"] == 8.60332


def test_el_reparto_suma_100_y_no_91():
    asg = _asignacion(REAL)
    suma = sum(v["neto"] for v in asg.values())
    assert abs(suma - 100.0) < 0.001
    # 91,63 era lo que salia antes, y es el valor con el que ES0138217031 llego
    # a la maestra.
    assert abs(suma - 91.63) > 1


def test_el_porcentaje_de_bolsa_deja_de_estar_mal():
    # Es lo que de verdad importa: no es un hueco en la suma, es una cifra
    # equivocada en el campo que pinta la radiografia de una cartera.
    asg = _asignacion(REAL)
    assert asg["rv"]["neto"] > 8          # 8,60 %
    assert asg["rv"]["neto"] != 0.23663   # lo que figuraba


def test_la_masa_sin_clasificar_se_cuenta():
    payload = {"allocationMap": {
        "AssetAllocCash": _clase(4.0),
        "AssetAllocBond": _clase(0.0),
        "AssetAllocUSEquity": _clase(0.0),
        "AssetAllocNonUSEquity": _clase(0.75),
        "AssetAllocOther": _clase(0.0),
        "AssetAllocNotClassified": _clase(95.25),
    }}
    asg = _asignacion(payload)
    # 'notclassified' no casaba con ninguna clase y su masa desaparecia. Va a
    # `otros` porque el canonico colapsa a cuatro clases de todas formas.
    assert asg["otros"]["neto"] == 95.25
    assert abs(sum(v["neto"] for v in asg.values()) - 100.0) < 0.001


def test_largo_y_corto_tambien_acumulan():
    payload = {"allocationMap": {
        "AssetAllocUSEquity": _clase(10.0, largo=12.0, corto=-2.0),
        "AssetAllocNonUSEquity": _clase(30.0, largo=35.0, corto=-5.0),
        "AssetAllocBond": _clase(60.0, largo=60.0, corto=0.0),
    }}
    asg = _asignacion(payload)
    assert asg["rv"]["neto"] == 40.0
    assert asg["rv"]["largo"] == 47.0
    assert asg["rv"]["corto"] == -7.0


def test_un_desglose_de_verdad_PARCIAL_sigue_sin_pisar_nada():
    # La guarda de 80-120 existe para los desgloses que el proveedor da a
    # medias, y eso no cambia: lo que cambia es que ya no se dispara por un
    # defecto nuestro.
    payload = {"allocationMap": {
        "AssetAllocCash": _clase(10.0),
        "AssetAllocBond": _clase(20.0),
        "AssetAllocUSEquity": _clase(5.0),
    }}
    assert _asignacion(payload) == {}


def test_sin_clases_reconocibles_no_se_escribe_nada():
    assert _asignacion({"allocationMap": {"AssetAllocLoQueSea": _clase(100.0)}}) == {}


def test_una_exposicion_apalancada_se_guarda_tal_cual():
    # ES0139113007 trae 312,76 % de bolsa y -237,8 % de liquidez: suma 100 y es
    # la exposicion bruta de verdad. El extractor la guarda; quien decide si eso
    # cabe en un reparto de 0 a 1 es el contrato de la plataforma, que la
    # rechaza por rango. La negativa va en la capa que sabe para que se usa.
    payload = {"allocationMap": {
        "AssetAllocNonUSEquity": _clase(312.76),
        "AssetAllocUSEquity": _clase(7.05),
        "AssetAllocCash": _clase(-237.81),
        "AssetAllocBond": _clase(18.0),
    }}
    asg = _asignacion(payload)
    assert asg["rv"]["neto"] == 319.81
    assert asg["liquidez"]["neto"] == -237.81
    assert abs(sum(v["neto"] for v in asg.values()) - 100.0) < 0.001


class TestElMismoDefectoEnElSnapshot:
    """`ASSET_CODES` manda dos codigos a `rf`, asi que podia pasar lo mismo.

    No es una medida: en las respuestas en cache el codigo "2" no aparece, asi
    que la colision no se puede demostrar hoy. Se cierra igual, porque la tabla
    la admite por construccion y lo que se pierde si ocurre es una parte de la
    renta fija de una cartera, sin aviso de ninguna clase.
    """

    def test_dos_codigos_a_la_misma_clase_se_suman(self):
        from fetchers import morningstar_lt as lt
        # "2" y "3" son los dos `rf` en ASSET_CODES.
        assert lt.ASSET_CODES["2"] == "rf"
        assert lt.ASSET_CODES["3"] == "rf"
        out = {}
        snapshot = {"Portfolios": [{"AssetAllocations": [{
            "Type": "MorningStarDefault", "SalePosition": "N",
            "BreakdownValues": [
                {"Type": "1", "Value": 40.0},
                {"Type": "2", "Value": 25.0},
                {"Type": "3", "Value": 30.0},
                {"Type": "7", "Value": 5.0},
            ]}]}]}
        lt._mapea_snapshot(out, snapshot)
        asg = ((out.get("cartera") or {}).get("asignacion_activos")) or {}
        # Sin escape: si la forma del snapshot cambiara, esta prueba tiene que
        # FALLAR y no saltarse, porque lo que vigila es que no se pierda masa.
        assert asg, "el snapshot no se mapeo: la forma cambio"
        # 25 + 30, no 30 a secas.
        assert asg["rf"]["neto"] == 55.0
        assert abs(sum(v["neto"] for v in asg.values()) - 100.0) < 0.001


def test_el_desglose_detallado_SUSTITUYE_al_del_snapshot():
    """Si se mezclan, la misma masa cuenta dos veces bajo dos nombres.

    Medido el 01-11-2026 en IE00BMW2TK08 (Lazard Global Convertibles): el
    snapshot clasificaba esa masa como `preferentes` 90,19 y el allocationMap la
    llama NotClassified, que va a `otros` 95,25. Con `set_path` a secas solo se
    pisan las clases que trae el allocationMap, asi que `preferentes` sobrevivia
    y el reparto sumaba 195. Lo introduje yo ese mismo dia al empezar a mapear
    NotClassified, que antes se perdia.
    """
    out = {}
    # lo que deja el snapshot: casi todo en `preferentes`
    out.setdefault("cartera", {})["asignacion_activos"] = {
        "preferentes": {"neto": 90.19343},
        "rv": {"neto": 2.75383},
        "liquidez": {"neto": 1.99331},
    }
    ms._mapea(out, {"allocationMap": {"allocationMap": {
        "AssetAllocCash": _clase(1.99331),
        "AssetAllocBond": _clase(0.0),
        "AssetAllocUSEquity": _clase(1.0),
        "AssetAllocNonUSEquity": _clase(1.75383),
        "AssetAllocOther": _clase(0.0),
        "AssetAllocNotClassified": _clase(95.25285),
    }}})
    asg = out["cartera"]["asignacion_activos"]
    assert "preferentes" not in asg, "la clase del snapshot tenia que desaparecer"
    assert abs(sum(v["neto"] for v in asg.values()) - 100.0) < 0.01
