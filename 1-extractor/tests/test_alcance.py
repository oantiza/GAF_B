# -*- coding: utf-8 -*-
"""El alcance de mercados ya manda, y la prueba que importa es la que protege a los fondos.

El 02-11-2026 el alcance paso de ser un documento a filtrar de verdad `update --all`. La
trampa de ese cambio no es sutil pero si facil: el criterio es un pais, los paises se
parecen a algo aplicable a cualquier fila, y **546 de los 760 fondos del universo son
luxemburgueses**. Un filtro que no mire el tipo se lleva la base por delante en la pasada
siguiente, en silencio y sin que falte ningun documento, porque nadie habria pedido los
datos.

Por eso `test_ningun_fondo_del_universo_real_queda_fuera` se mide contra
`config/fondos.csv` y no contra ejemplos inventados: es la unica forma de que la prueba
siga valiendo cuando alguien anada o quite un pais.
"""
import csv
import io
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import alcance as a  # noqa: E402


def test_un_fondo_no_lo_gobierna_el_alcance():
    al = a.Alcance({"ES": "Espana"}, {"AU": "Australia"})
    assert al.estado("AU0000000001", "accion") == a.FUERA
    assert al.estado("AU0000000001", "fondo") == a.DENTRO
    assert al.estado("AU0000000001", "etf") == a.DENTRO


def test_un_tipo_que_no_conocemos_tampoco():
    """No se puede afirmar que una fila es una accion porque su ISIN empiece por AU."""
    al = a.Alcance({"ES": "Espana"}, {"AU": "Australia"})
    assert al.estado("AU0000000001", "") == a.DENTRO
    assert al.estado("AU0000000001", None) == a.DENTRO


def test_un_pais_sin_decidir_no_es_un_pais_fuera():
    """El tercer valor existe para esto: `False` afirmaria una decision que nadie tomo."""
    al = a.Alcance({"ES": "Espana"}, {"AU": "Australia"})
    assert al.estado("SE0000000001", "accion") == a.SIN_DECIDIR
    assert "nadie ha decidido" in al.motivo("SE0000000001", "accion")


def test_sin_fichero_no_se_inventa_un_alcance():
    """Una ruta mal puesta no puede excluir al catalogo entero."""
    vacio = a.carga(RAIZ / "no" / "existe")
    assert vacio.estado("AU0000000001", "accion") == a.DENTRO
    assert a.Alcance({}, {}).estado("JP0000000001", "accion") == a.DENTRO


def test_un_pais_en_las_dos_listas_es_una_contradiccion():
    with pytest.raises(ValueError, match="las dos listas"):
        a.Alcance({"ES": "Espana"}, {"ES": "Espana otra vez"})


def test_reparte_conserva_el_orden_y_no_pierde_filas():
    al = a.Alcance({"ES": "Espana"}, {"AU": "Australia"})
    objetivos = [("ES0000000001", "accion"), ("AU0000000001", "accion"),
                 ("SE0000000001", "accion"), ("LU0000000002", "fondo")]
    g = al.reparte(objetivos)
    assert sum(len(v) for v in g.values()) == len(objetivos)
    assert [i for i, _ in g[a.DENTRO]] == ["ES0000000001", "LU0000000002"]
    assert [i for i, _ in g[a.FUERA]] == ["AU0000000001"]
    assert [i for i, _ in g[a.SIN_DECIDIR]] == ["SE0000000001"]


# --- medido contra el universo y el alcance de verdad, no contra ejemplos ---

def _universo():
    with io.open(RAIZ / "config" / "fondos.csv", encoding="utf-8") as f:
        return [(r["isin"], r["tipo"]) for r in csv.DictReader(f)]


def test_ningun_fondo_del_universo_real_queda_fuera():
    """La prueba de la trampa. Si falla, la pasada siguiente deja la base muda."""
    al = a.carga(RAIZ)
    no_acciones = [(i, t) for i, t in _universo() if t != "accion"]
    assert no_acciones, "el universo no tiene fondos: la prueba no estaria midiendo nada"
    fuera = [i for i, t in no_acciones if al.estado(i, t) != a.DENTRO]
    assert fuera == [], f"{len(fuera)} fondos o ETF excluidos por el alcance: {fuera[:5]}"


def test_las_acciones_del_universo_estan_todas_decididas():
    """Hoy no debe haber ninguna `SIN_DECIDIR`: si aparece una, hay que decidir su pais."""
    al = a.carga(RAIZ)
    acciones = [(i, t) for i, t in _universo() if t == "accion"]
    g = al.reparte(acciones)
    assert g[a.SIN_DECIDIR] == [], (
        "acciones de un pais que no esta ni dentro ni fuera: "
        + ", ".join(i for i, _ in g[a.SIN_DECIDIR][:5]))
    assert len(g[a.DENTRO]) + len(g[a.FUERA]) == len(acciones)


def test_el_alcance_de_hoy_deja_dentro_las_529():
    """Las cifras de las decisiones del 02-11-2026, para que se note si alguien las cambia.

    Eran 306 hasta que Oscar saco a CEVASA por su nombre esa misma tarde. Que ahora
    aparezca un ES en la lista de fuera no es un fallo del criterio de pais: es una
    exclusion por instrumento, que gana al pais a proposito.

    Desde el 08-11-2026 son 485 de 492: la decision 38 da de alta 180 acciones de once indices
    y anade seis paises (SE, BE, DK, JE, AT, BM) a `paises_dentro`; las 7 de fuera no cambian.
    Son 484 de 491 desde la decision 39: sale la linea when-issued de Honeywell.
    Son 516 de 523 desde la decision 43: entran las 32 del FTSE MIB que faltaban.
    Son 515 de 522 desde la decision 44: sale Prysmian.
    Son 526 de 533 desde la decision B-77 (10-11-2026): entran 11 acciones que un cliente ya
    tiene en cartera (US, ES, FR y GB, paises que ya estaban dentro); las 7 de fuera no cambian.
    Son 527 de 534 por la misma decision: entra Kimberly-Clark, que compro Kenvue el 02-11-2026.
    Vuelven a ser 526 de 533 el mismo dia: sale Kenvue, que dejo de cotizar el 02-11-2026 al
    cerrar Kimberly-Clark su compra (decision de Oscar del 10-11-2026).
    Son 529 de 536 desde el 12-11-2026, por la misma puerta de B-77: entran tres ADR que otro
    cliente tiene en cartera (Alibaba, BioNTech y Hello Group, ISIN US); las 7 de fuera no cambian.
    """
    al = a.carga(RAIZ)
    acciones = [(i, t) for i, t in _universo() if t == "accion"]
    g = al.reparte(acciones)
    assert len(acciones) == 536
    assert len(g[a.DENTRO]) == 529
    assert sorted({i[:2] for i, _ in g[a.FUERA]}) == ["AU", "ES", "JP"]
    assert [i for i, _ in g[a.FUERA] if i.startswith("ES")] == ["ES0132955008"]


def test_el_fichero_y_el_modulo_hablan_del_mismo_sitio():
    """Si alguien renombra el fichero, que falle aqui y no en una pasada de madrugada."""
    ruta = RAIZ / "config" / a.NOMBRE_FICHERO
    assert ruta.exists()
    cfg = json.loads(ruta.read_text(encoding="utf-8"))
    al = a.carga(RAIZ)
    assert set(al.dentro) == set(cfg["paises_dentro"])
    assert set(al.fuera) == set(cfg["paises_fuera"])


# ------------------------------------------- exclusion por instrumento (02-11-2026)
def test_un_isin_nombrado_gana_a_su_pais():
    # CEVASA es espanola y "en Espana entran todas" es la unica decision explicita del
    # fichero, asi que por pais no habia forma de sacarla: hay que nombrarla.
    al = a.Alcance({"ES": "Espana"}, {"AU": "Australia"},
                   {"ES0132955008": "la saco Oscar el 02-11-2026"})
    assert al.estado("ES0132955008", "accion") == a.FUERA
    assert al.estado("ES0105025003", "accion") == a.DENTRO


def test_un_isin_nombrado_NO_mira_el_tipo_y_el_pais_SI():
    """La diferencia deliberada entre los dos criterios, que es facil de borrar sin querer.

    El criterio de pais se limita a las acciones porque 546 de los 760 fondos del
    universo son luxemburgueses y un filtro por pais se los llevaria en silencio. Nombrar
    un ISIN es un acto explicito sobre UN instrumento: limitarlo a las acciones solo
    conseguiria que una exclusion escrita a mano no hiciera nada, sin avisar.
    """
    al = a.Alcance({"ES": "Espana"}, {"LU": "Luxemburgo"},
                   {"LU9999999999": "un fondo que alguien saco a mano"})
    assert al.estado("LU9999999999", "fondo") == a.FUERA     # nombrado: fuera
    assert al.estado("LU2504555777", "fondo") == a.DENTRO    # por pais: el tipo lo salva


def test_el_motivo_de_un_isin_nombrado_dice_por_que():
    al = a.Alcance({"ES": "Espana"}, {}, {"ES0132955008": "porque lo dijo Oscar"})
    assert al.motivo("ES0132955008", "accion") == "porque lo dijo Oscar"
    assert al.motivo("ES0105025003", "accion") == ""


def test_el_canonico_no_dejaria_fuera_ni_un_fondo():
    """La misma trampa, un eslabon mas abajo: desde el 02-11-2026 el alcance filtra
    tambien `export_bdb/`, y ahi se mira el tipo de la FICHA, no el del universo.

    Se mide contra `data/funds` de verdad y no contra ejemplos, que es lo unico que
    sigue valiendo cuando alguien cambie un pais.
    """
    al = a.carga(RAIZ)
    funds = RAIZ / "data" / "funds"
    if not funds.exists():
        pytest.skip("sin fichas en este arbol")
    fuera_por_tipo = {}
    for ruta in funds.glob("*.json"):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        tipo = ((d.get("identificacion") or {}).get("tipo") or "").strip().lower()
        if al.estado(ruta.stem, tipo) != a.DENTRO:
            fuera_por_tipo.setdefault(tipo, []).append(ruta.stem)
    assert "fondo" not in fuera_por_tipo, (
        "el alcance esta sacando fondos del canonico: " + str(fuera_por_tipo.get("fondo"))[:120])
    assert "etf" not in fuera_por_tipo
    # Las acciones que quedan fuera lo estan por lo que dice el alcance: su pais o su ISIN.
    # Comparar con una lista fija se rompia cada vez que una ficha de un pais excluido
    # seguia en disco, y no decia nada sobre si el criterio se estaba aplicando bien.
    sin_motivo = [i for i in fuera_por_tipo.get("accion", [])
                  if i[:2] not in al.fuera and i not in al.isines_fuera]
    assert sin_motivo == []
    assert "ES0132955008" in fuera_por_tipo.get("accion", [])


# ------------------------------------------- alcance de FIRDS (decision 34, 07-11-2026)
def test_mic_firds_del_fichero_coincide_con_la_constante():
    """Fichero y constante cambian juntos o esta prueba falla."""
    from fetchers import esma_firds
    cfg = json.loads((RAIZ / "config" / a.NOMBRE_FICHERO).read_text(encoding="utf-8"))
    assert tuple(cfg["mic_firds"]) == esma_firds.MIC_POR_DEFECTO
    assert a.mic_firds(RAIZ) == esma_firds.MIC_POR_DEFECTO
    assert esma_firds.mic_por_defecto() == esma_firds.MIC_POR_DEFECTO
    assert cfg["mic_firds_motivo"].strip()


def test_xetb_no_esta_y_los_candidatos_futuros_no_estan_activos():
    cfg = json.loads((RAIZ / "config" / a.NOMBRE_FICHERO).read_text(encoding="utf-8"))
    assert "XETB" not in cfg["mic_firds"]
    assert cfg["mic_firds_candidatos_futuros"] == ["XSTO", "XCSE", "XOSL", "XWBO", "XWAR"]
    assert not set(cfg["mic_firds_candidatos_futuros"]) & set(cfg["mic_firds"])


def test_sin_clave_mic_firds_se_cae_a_la_constante(tmp_path):
    from fetchers import esma_firds
    assert a.mic_firds(tmp_path) is None
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / a.NOMBRE_FICHERO).write_text("{}", encoding="utf-8")
    assert esma_firds.mic_por_defecto(tmp_path) == esma_firds.MIC_POR_DEFECTO


def test_sec_user_agent_lleva_nombre_y_correo():
    import re
    s = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    ua = s["sec_user_agent"]
    m = re.fullmatch(r"(?P<nombre>[^@]+?)\s+(?P<correo>[\w.+-]+@[\w-]+(\.[\w-]+)+)", ua)
    assert m and m["nombre"].strip(), ua
    assert ua != s["user_agent"]
