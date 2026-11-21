"""Generador de borradores de cartera por nivel de riesgo (decisión 122 de Óscar, 06-11-2026).

Recupera «Generar preselección», que la decisión 15 retiró el 04-11-2026 porque elegía entre los 200 primeros resultados del
Buscador por lo que más había subido. El criterio lo decidió Óscar el 06-11-2026 sobre medidas del catálogo y una prueba fuera de
muestra; la página del criterio, con esas medidas, está enlazada en `docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`.

**Qué es cada nivel.** Un porcentaje de renta variable (`RENTA_VARIABLE_POR_NIVEL`). El resto, en renta fija: más a corto plazo
cuanto más bajo el nivel. Los nombres son los de Comprobar (`RISK_PROFILE_CONTRACTS` de la aplicación).

**Cómo se elige cada fondo.** Por bloques fijos (`BLOQUES`), cada uno con sus categorías del proveedor. Dentro de cada bloque, una
puntuación por pilares, siempre frente a los fondos de ese mismo bloque y por su posición en el grupo (percentil):

- Calidad de la gestión (40 %): ratio de Sharpe a 3 y 5 años y Sortino a 5 años.
- Solidez (30 %): patrimonio y años desde el lanzamiento de la clase.
- Consistencia (20 %): la parte de los meses de los últimos 5 años en que su rentabilidad a 12 meses supera la mediana de su bloque.
- Coste (10 %): gasto corriente del KID.

Las medidas de rentabilidad, riesgo y consistencia se calculan aquí, con la serie que usa el motor (la misma que Simular, con sus
recortes del histórico) llevada a fin de mes, y con el €STR de cada mes como tipo sin riesgo: todas con el mismo estimador. El
ratio de información y el alfa NO entran: los tienen la mitad de los fondos y medidos contra referencias distintas.

**Lo que no promete.** La prueba fuera de muestra (octubre de 2021, 2022 y 2023, tres años después) dejó a los elegidos de todas las
reglas cerca de la mitad de su grupo: ninguna elige de forma fiable los fondos que irán mejor. Es un borrador para empezar, con su
aviso, y no una recomendación.

**Qué entra.** Solo fondos (los ETF no se traspasan); por defecto, solo gestión activa (`incluir_indexados` los deja entrar); en
euros, de acumulación, con gasto corriente, con 100 M o más de patrimonio, con fecha de lanzamiento, que el motor no excluya y con 5
años completos de serie. Ningún fondo por encima del 25 % ni por debajo del 5 %. El número de fondos lo pide el asesor; cada nivel
tiene un mínimo (`minimo_de_fondos`) para no saltarse el tope ni deformar el riesgo del nivel juntando partes distintas.

Solo con la base nueva: la vieja no guarda el patrimonio de los fondos.
"""

from __future__ import annotations

import math
import statistics
import threading
import time
from datetime import date
from typing import Callable, Dict, Iterable, List, Optional, Tuple

METODO = "GENERADOR_V1"

RENTA_VARIABLE_POR_NIVEL = {1: 0, 2: 10, 3: 20, 4: 30, 5: 40, 6: 50, 7: 60, 8: 70, 9: 85, 10: 100}
NOMBRE_DEL_NIVEL = {1: "Preservación", 2: "Prudente", 3: "Moderado bajo", 4: "Moderado", 5: "Equilibrado",
                    6: "Equilibrado dinámico", 7: "Dinámico", 8: "Crecimiento", 9: "Agresivo", 10: "Muy agresivo"}

# Bloque: (parte, categorías del proveedor). La parte decide con quién se junta un bloque cuando hay que juntar.
BLOQUES: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    "Liquidez y renta fija a muy corto": ("RF a corto", ("EAA Fund EUR Money Market", "EAA Fund EUR Ultra Short-Term Bond")),
    "Renta fija a corto plazo": ("RF a corto", ("EAA Fund EUR Diversified Bond - Short Term",)),
    "Renta fija euro diversificada": ("RF principal", ("EAA Fund EUR Diversified Bond",)),
    "Renta fija corporativa euro": ("RF principal", ("EAA Fund EUR Corporate Bond",)),
    "Renta variable global": ("RV", ("EAA Fund Global Large-Cap Blend Equity",)),
    "Renta variable Europa": ("RV", ("EAA Fund Europe Large-Cap Blend Equity",)),
    "Renta variable EE. UU.": ("RV", ("EAA Fund US Large-Cap Blend Equity",)),
    "Renta variable emergentes": ("RV", ("EAA Fund Global Emerging Markets Equity",)),
}
REPARTO_RENTA_VARIABLE = {"Renta variable global": 0.50, "Renta variable Europa": 0.25,
                          "Renta variable EE. UU.": 0.15, "Renta variable emergentes": 0.10}

TOPE_POR_FONDO = 0.25
MINIMO_POR_POSICION = 0.05
PATRIMONIO_MINIMO = 100e6
MESES = 60
PESOS = {"calidad": 0.40, "solidez": 0.30, "consistencia": 0.20, "coste": 0.10}
FONDOS_POR_DEFECTO = 8
FONDOS_MAXIMOS = 30

# Un fondo indexado se reconoce por su nombre: el dato no lo marca. Contrastado el 06-11-2026 con la marca del extractor
# (`is_index_like`): todos los que reconoce el nombre los marca él; los que marca él y el nombre no son ETF, que aquí no entran, y
# dos mixtos de DWS que invierten en ETF y cuentan como gestión activa.
_PALABRAS_DE_INDEXADO = ("index", "indexa", "equiponderado", "ucits etf")

CATEGORIA_A_BLOQUE = {categoria: bloque for bloque, (_, categorias) in BLOQUES.items() for categoria in categorias}


class GeneradorNoDisponible(Exception):
    """El generador no puede trabajar con esta base o con estos datos; el mensaje se enseña tal cual."""


def es_indexado(nombre: Optional[str]) -> bool:
    texto = (nombre or "").lower()
    return any(palabra in texto for palabra in _PALABRAS_DE_INDEXADO)


# ─────────────────────────────────────────── pesos por bloque y número de fondos ───────────────────────────────────────────

def pesos_de_bloque(nivel: int) -> Dict[str, float]:
    renta_variable = RENTA_VARIABLE_POR_NIVEL[nivel] / 100
    renta_fija = 1 - renta_variable
    a_corto = max(0.30, 1 - 0.2 * (nivel - 1))   # la parte de la renta fija que va a corto: toda en el 1, un 30 % desde el 5
    pesos = {
        "Liquidez y renta fija a muy corto": renta_fija * a_corto * 0.5,
        "Renta fija a corto plazo": renta_fija * a_corto * 0.5,
        "Renta fija euro diversificada": renta_fija * (1 - a_corto) * 0.5,
        "Renta fija corporativa euro": renta_fija * (1 - a_corto) * 0.5,
    }
    for bloque, parte in REPARTO_RENTA_VARIABLE.items():
        pesos[bloque] = renta_variable * parte
    return {bloque: peso for bloque, peso in pesos.items() if peso > 1e-9}


def _parte(bloque: str) -> str:
    return BLOQUES[bloque][0]


def _plegar(pesos: Dict[str, float], bloque: str, cruzar: bool = False) -> bool:
    """Suma el bloque al mayor de su misma parte. Con `cruzar`, una parte de renta fija entera puede ir a la otra; nunca a renta variable."""
    destino = [otro for otro in pesos if otro != bloque and _parte(otro) == _parte(bloque)]
    if not destino and cruzar and _parte(bloque) != "RV":
        destino = [otro for otro in pesos if otro != bloque and _parte(otro) != "RV"]
    if not destino:
        return False
    mayor = max(destino, key=lambda otro: (pesos[otro], otro))
    pesos[mayor] += pesos.pop(bloque)
    return True


def _necesarios(pesos: Dict[str, float]) -> int:
    return sum(math.ceil(round(peso / TOPE_POR_FONDO, 9)) for peso in pesos.values())


def repartir(nivel: int, num_fondos: int, disponibles: Dict[str, int]) -> Tuple[Optional[Dict[str, Tuple[float, int]]], int]:
    """{bloque: (peso, número de fondos)} y el mínimo de fondos del nivel. Si `num_fondos` no llega al mínimo, (None, mínimo).

    `disponibles` es cuántos fondos elegibles tiene cada bloque. Un bloque sin ninguno, o por debajo del 5 %, se suma al mayor de
    su parte. Si hay menos fondos que bloques, se juntan bloques dentro de su parte, nunca entre partes: juntar la renta fija a
    corto con la principal cambiaría el riesgo del nivel.
    """
    pesos = pesos_de_bloque(nivel)
    for bloque in sorted(list(pesos), key=lambda b: (pesos[b], b)):
        if bloque in pesos and (disponibles.get(bloque, 0) == 0 or pesos[bloque] < MINIMO_POR_POSICION):
            _plegar(pesos, bloque, cruzar=True)
    while _necesarios(pesos) > num_fondos or len(pesos) > num_fondos:
        if not any(_plegar(pesos, bloque) for bloque in sorted(pesos, key=lambda b: (pesos[b], b))):
            break
    # Un bloque con menos fondos de los que pide su peso para no pasar del 25 % se suma al mayor de su parte; si no puede, no
    # hay borrador: repartirlo entre los que hay rompería el tope (lo vio el revisor del 06-11-2026 en un caso construido).
    for bloque in sorted(list(pesos), key=lambda b: (pesos[b], b)):
        if bloque in pesos and disponibles.get(bloque, 0) < math.ceil(round(pesos[bloque] / TOPE_POR_FONDO, 9)):
            if not _plegar(pesos, bloque, cruzar=True):
                raise GeneradorNoDisponible(f"{bloque}: no hay fondos elegibles suficientes para que ninguno pase del 25 %.")
    for bloque in pesos:
        if disponibles.get(bloque, 0) < math.ceil(round(pesos[bloque] / TOPE_POR_FONDO, 9)):
            raise GeneradorNoDisponible(f"{bloque}: no hay fondos elegibles suficientes para que ninguno pase del 25 %.")
    minimo = max(_necesarios(pesos), len(pesos))
    if num_fondos < minimo:
        return None, minimo
    cuantos = {bloque: max(1, math.ceil(round(peso / TOPE_POR_FONDO, 9))) for bloque, peso in pesos.items()}
    resto = num_fondos - sum(cuantos.values())
    while resto > 0:
        opciones = [b for b in pesos if cuantos[b] < disponibles.get(b, 0) and pesos[b] / (cuantos[b] + 1) >= MINIMO_POR_POSICION - 1e-12]
        if not opciones:
            break
        elegido = max(opciones, key=lambda b: (pesos[b] / cuantos[b], b))
        cuantos[elegido] += 1
        resto -= 1
    return {bloque: (peso, cuantos[bloque]) for bloque, peso in pesos.items()}, minimo


def limites_de_fondos(nivel: int, disponibles: Dict[str, int]) -> Tuple[int, int]:
    """El mínimo y el máximo de fondos que admite el nivel con estos fondos disponibles."""
    _, minimo = repartir(nivel, 1, disponibles)
    reparto, _ = repartir(nivel, FONDOS_MAXIMOS, disponibles)
    return minimo, sum(n for _, n in reparto.values()) if reparto else minimo


# ──────────────────────────────────────────────────── medidas de la serie ────────────────────────────────────────────────────

def meses_hasta(ultimo: str, cuantos: int) -> List[str]:
    """Los `cuantos` meses (AAAA-MM) que acaban en `ultimo`, en orden."""
    anio, mes = int(ultimo[:4]), int(ultimo[5:7])
    salida = []
    for _ in range(cuantos):
        salida.append(f"{anio:04d}-{mes:02d}")
        mes -= 1
        if mes == 0:
            anio, mes = anio - 1, 12
    return salida[::-1]


def ultimo_mes_completo(valores: Dict[date, float]) -> Optional[str]:
    """El mes anterior al de su último dato (AAAA-MM): el del último dato puede estar a medias."""
    if not valores:
        return None
    ultimo_dia = max(valores)
    return meses_hasta(f"{ultimo_dia.year:04d}-{ultimo_dia.month:02d}", 2)[0]


def llega_al_ultimo_mes(propio: Optional[str], comun: str) -> bool:
    """Si el último mes completo de un fondo alcanza al de la mayoría.

    OPT-4 (auditoría del 16-11-2026). La ventana acaba en el último mes completo que tiene la mayoría, y a cada fondo
    solo se le pedía tener dato en todos los meses. Un fondo atrasado lo tiene: `fin_de_mes` le da como «cierre» de su
    último mes el último valor que haya, aunque sea del día 10. Con la mayoría cerrando en octubre y un fondo parado el
    10 de octubre, ese fondo se medía con octubre a medias. Su último mes completo es septiembre, y no llega."""
    return bool(propio) and propio >= comun


def fin_de_mes(valores: Dict[date, float]) -> Dict[str, float]:
    """El último valor de cada mes."""
    salida = {}
    for dia in sorted(valores):
        salida[f"{dia.year:04d}-{dia.month:02d}"] = valores[dia]
    return salida


def medidas(serie: Dict[str, float], meses: List[str], tipo_mensual: Callable[[str], float]) -> Optional[dict]:
    """Rentabilidad anualizada, volatilidad, Sharpe y Sortino sobre los meses dados (fin de mes a fin de mes)."""
    if any(mes not in serie for mes in meses) or len(meses) < 25:
        return None
    rentas = [serie[meses[k]] / serie[meses[k - 1]] - 1 for k in range(1, len(meses))]
    tipos = [tipo_mensual(meses[k]) / 12 for k in range(1, len(meses))]
    n = len(rentas)
    valor = 1.0
    for renta in rentas:
        valor *= 1 + renta
    anual = valor ** (12 / n) - 1
    volatilidad = statistics.stdev(rentas) * math.sqrt(12)
    tipo_anual = sum(tipos) / n * 12
    abajo = math.sqrt(sum(min(0.0, r - t) ** 2 for r, t in zip(rentas, tipos)) / n) * math.sqrt(12)
    return {
        "anual": anual,
        "volatilidad": volatilidad,
        "sharpe": (anual - tipo_anual) / volatilidad if volatilidad > 0 else None,
        "sortino": (anual - tipo_anual) / abajo if abajo > 0 else None,
    }


def consistencia(series: Dict[str, Dict[str, float]], meses: List[str]) -> Dict[str, Optional[float]]:
    """La parte de los meses en que la rentabilidad a 12 meses de cada fondo supera la mediana del grupo."""
    cuenta = {fondo: [0, 0] for fondo in series}
    for k in range(12, len(meses)):
        antes, ahora = meses[k - 12], meses[k]
        a12 = {f: s[ahora] / s[antes] - 1 for f, s in series.items() if antes in s and ahora in s}
        if len(a12) < 2:
            continue
        mediana = statistics.median(a12.values())
        for fondo, valor in a12.items():
            cuenta[fondo][1] += 1
            cuenta[fondo][0] += valor > mediana
    return {fondo: (arriba / total if total else None) for fondo, (arriba, total) in cuenta.items()}


def percentil(valores: Iterable[Optional[float]], valor: Optional[float], mayor_es_mejor: bool) -> float:
    """De 0 a 1: la parte del grupo que queda por detrás, con los empates a medias. Sin dato, o solo, en el centro."""
    lista = [x for x in valores if x is not None]
    if valor is None or len(lista) < 2:
        return 0.5
    peores = sum(1 for x in lista if (x < valor if mayor_es_mejor else x > valor))
    iguales = sum(1 for x in lista if x == valor) - 1
    return (peores + iguales / 2) / (len(lista) - 1)


def puntuar(fondos: List[dict], meses: List[str], tipo_mensual: Callable[[str], float]) -> Dict[str, dict]:
    """Los cuatro pilares y la nota de cada fondo, frente a los demás de la lista (que son los de un mismo bloque)."""
    cinco = {f["asset_id"]: medidas(f["serie"], meses, tipo_mensual) for f in fondos}
    tres = {f["asset_id"]: medidas(f["serie"], meses[-37:], tipo_mensual) for f in fondos}
    sostenida = consistencia({f["asset_id"]: f["serie"] for f in fondos}, meses)
    ids = [f["asset_id"] for f in fondos]
    por_id = {f["asset_id"]: f for f in fondos}

    def columna(funcion):
        return [funcion(i) for i in ids]

    salida = {}
    for i in ids:
        calidad = statistics.mean([
            percentil(columna(lambda j: tres[j] and tres[j]["sharpe"]), tres[i] and tres[i]["sharpe"], True),
            percentil(columna(lambda j: cinco[j] and cinco[j]["sharpe"]), cinco[i] and cinco[i]["sharpe"], True),
            percentil(columna(lambda j: cinco[j] and cinco[j]["sortino"]), cinco[i] and cinco[i]["sortino"], True),
        ])
        solidez = statistics.mean([
            percentil(columna(lambda j: por_id[j]["patrimonio"]), por_id[i]["patrimonio"], True),
            percentil(columna(lambda j: por_id[j]["anios"]), por_id[i]["anios"], True),
        ])
        constancia = percentil(columna(lambda j: sostenida[j]), sostenida[i], True)
        coste = percentil(columna(lambda j: por_id[j]["gasto_corriente_pct"]), por_id[i]["gasto_corriente_pct"], False)
        pilares = {"calidad": calidad, "solidez": solidez, "consistencia": constancia, "coste": coste}
        salida[i] = {
            "pilares": {clave: round(valor, 4) for clave, valor in pilares.items()},
            "nota": round(sum(PESOS[clave] * valor for clave, valor in pilares.items()), 4),
            "medidas": {
                "sharpe_3a": tres[i] and tres[i]["sharpe"], "sharpe_5a": cinco[i] and cinco[i]["sharpe"],
                "sortino_5a": cinco[i] and cinco[i]["sortino"], "volatilidad_5a": cinco[i] and cinco[i]["volatilidad"],
                "meses_por_encima_de_la_mediana": sostenida[i],
            },
        }
    return salida


def _gestora(nombre: str) -> str:
    """La primera palabra del nombre, que en este catálogo es la gestora («Vanguard», «Fidelity», «JPMorgan»)."""
    return (nombre or "").strip().split(" ")[0].lower()


def _elegir(ordenados: List[dict], cuantos: int) -> List[dict]:
    """Los mejores por nota, de gestoras distintas mientras se pueda.

    La decisión 122 no lo decía, y se dice en pantalla y en la decisión: evita meter dos clases del mismo fondo (DWS High Conviction
    LC y NC) o dos fondos casi iguales de una gestora en el mismo bloque. Por eso puede quedar fuera uno con mejor nota que un elegido.
    """
    elegidos, gestoras = [], set()
    for fondo in ordenados:
        if len(elegidos) == cuantos:
            break
        if _gestora(fondo["nombre"]) not in gestoras:
            elegidos.append(fondo)
            gestoras.add(_gestora(fondo["nombre"]))
    for fondo in ordenados:
        if len(elegidos) == cuantos:
            break
        if fondo not in elegidos:
            elegidos.append(fondo)
    return elegidos


# ─────────────────────────────────────────────────────── el borrador ───────────────────────────────────────────────────────

def componer(nivel: int, num_fondos: int, incluir_indexados: bool, elegibles: List[dict], ultimo_mes: str,
             tipo_mensual: Callable[[str], float], fuera: Dict[str, int]) -> dict:
    """El borrador con los fondos ya elegibles (cada uno con su `serie` a fin de mes). Puro: no lee ninguna base."""
    meses = meses_hasta(ultimo_mes, MESES + 1)
    por_bloque: Dict[str, List[dict]] = {bloque: [] for bloque in BLOQUES}
    for fondo in elegibles:
        if incluir_indexados or not fondo["indexado"]:
            por_bloque[fondo["bloque"]].append(fondo)
    notas: Dict[str, dict] = {}
    for bloque, fondos in por_bloque.items():
        if fondos:
            notas.update(puntuar(fondos, meses, tipo_mensual))
    disponibles = {bloque: len(fondos) for bloque, fondos in por_bloque.items()}
    minimo, maximo = limites_de_fondos(nivel, disponibles)
    base = {
        "metodo": METODO,
        "nivel": nivel,
        "nombre_del_nivel": NOMBRE_DEL_NIVEL[nivel],
        "renta_variable_pct": RENTA_VARIABLE_POR_NIVEL[nivel],
        "num_fondos_pedidos": num_fondos,
        "minimo_de_fondos": minimo,
        "maximo_de_fondos": maximo,
        "incluir_indexados": incluir_indexados,
        "ventana": {"desde": meses[0], "hasta": meses[-1]},
        "pesos": dict(PESOS),
        "candidatos_por_bloque": disponibles,
        "fuera_por_motivo": fuera,
    }
    reparto, _ = repartir(nivel, num_fondos, disponibles)
    if reparto is None:
        return {**base, "estado": "FALTAN_FONDOS", "posiciones": [],
                "aviso": f"El nivel {nivel} necesita al menos {minimo} fondos para no pasar del 25 % en ninguno ni mezclar partes de la cartera."}
    posiciones, avisos = [], []
    for bloque, (peso, cuantos) in reparto.items():
        ordenados = sorted(por_bloque[bloque], key=lambda f: (-notas[f["asset_id"]]["nota"], f["gasto_corriente_pct"], f["asset_id"]))
        elegidos = _elegir(ordenados, cuantos)
        if len(elegidos) < cuantos:
            avisos.append(f"{bloque}: solo hay {len(elegidos)} {'fondo elegible' if len(elegidos) == 1 else 'fondos elegibles'}.")
        # Cada bloque cuadra por su cuenta, en centésimas: lo que sobra del redondeo no pasa de la renta fija a la variable.
        del_bloque = round(peso * 100, 2)
        partes = [round(del_bloque / len(elegidos), 2)] * len(elegidos)
        partes[0] = round(partes[0] + round(del_bloque - sum(partes), 2), 2)
        for fondo, parte in zip(elegidos, partes):
            nota = notas[fondo["asset_id"]]
            posiciones.append({
                "asset_id": fondo["asset_id"],
                "nombre": fondo["nombre"],
                "bloque": bloque,
                "peso_pct": parte,
                "nota": nota["nota"],
                "pilares": nota["pilares"],
                "medidas": nota["medidas"],
                "gasto_corriente_pct": fondo["gasto_corriente_pct"],
                "patrimonio": fondo["patrimonio"],
                "patrimonio_divisa": fondo.get("patrimonio_divisa"),
                "anios": round(fondo["anios"], 1),
                "indexado": fondo["indexado"],
                "candidatos_del_bloque": len(por_bloque[bloque]),
            })
    _cuadrar_a_cien(posiciones)
    if num_fondos > len(posiciones):
        avisos.append(f"Pediste {num_fondos} fondos y salen {len(posiciones)}: no caben más sin bajar del 5 % por fondo o no hay más elegibles.")
    return {**base, "estado": "OK", "posiciones": posiciones, "avisos": avisos,
            "gasto_corriente_medio_pct": round(sum(p["peso_pct"] * p["gasto_corriente_pct"] for p in posiciones) / 100, 4)}


def _cuadrar_a_cien(posiciones: List[dict]) -> None:
    """Los pesos van redondeados a dos decimales; la diferencia con 100 se lleva a la mayor posición, para que sumen 100 exactos."""
    if not posiciones:
        return
    diferencia = round(100 - sum(p["peso_pct"] for p in posiciones), 2)
    if diferencia:
        mayor = max(posiciones, key=lambda p: p["peso_pct"])
        mayor["peso_pct"] = round(mayor["peso_pct"] + diferencia, 2)


# ───────────────────────────────────────────────────── lectura de la base ─────────────────────────────────────────────────────

_CERROJO = threading.Lock()
_GUARDADO: Dict[str, Tuple[float, tuple]] = {}
_TTL_SEGUNDOS = 15 * 60


def _anios_desde(fecha: Optional[str], hasta: str) -> Optional[float]:
    if not fecha or len(str(fecha)) < 7:
        return None
    try:
        return (int(hasta[:4]) - int(str(fecha)[:4])) + (int(hasta[5:7]) - int(str(fecha)[5:7])) / 12
    except ValueError:
        return None


def cargar_elegibles(lector_de_activos, lector_de_series, estr_diaria: List[Tuple[date, float]]) -> Tuple[List[dict], str, Callable[[str], float], Dict[str, int]]:
    """Los fondos que pueden entrar (indexados incluidos, marcados), el último mes común, el €STR mensual y cuántos quedan fuera por cada motivo.

    Lee la base nueva: las tarjetas de todos los fondos, las raíces de los de las categorías de los bloques, y la serie de los que
    pasan los filtros. Se guarda 15 minutos en memoria: el catálogo no cambia entre dos borradores.
    """
    from optimization.repository import PriceSeriesProblem, _load_window_values, _root_exclusion_reason

    ahora = time.monotonic()
    with _CERROJO:
        guardado = _GUARDADO.get("elegibles")
        if guardado and ahora - guardado[0] <= _TTL_SEGUNDOS:
            return guardado[1]

    indice = lector_de_activos.get_search_index() or {}
    ids_de_fondos = [e["id"] for e in indice.get("entries", []) if e.get("type") == "FUND" and e.get("id")]
    if not ids_de_fondos:
        raise GeneradorNoDisponible("El catálogo no ha devuelto ningún fondo.")
    tarjetas = lector_de_activos._datos_por_instrumento(ids_de_fondos, "read", "card")
    fuera: Dict[str, int] = {}

    def descartar(motivo: str):
        fuera[motivo] = fuera.get(motivo, 0) + 1

    preliminares = []
    for asset_id, tarjeta in tarjetas.items():
        categoria = (tarjeta.get("classification") or {}).get("category")
        bloque = CATEGORIA_A_BLOQUE.get(categoria)
        if not bloque:
            continue
        nombre = (tarjeta.get("identity") or {}).get("name") or asset_id
        costes = tarjeta.get("costs") or {}
        tamano = tarjeta.get("size") or {}
        metricas = tarjeta.get("metrics") or {}
        if (tarjeta.get("identity") or {}).get("currency") != "EUR":
            descartar("no está en euros"); continue
        if metricas.get("distribution_policy") == "DISTRIBUTING":
            descartar("reparte"); continue
        if not isinstance(costes.get("ongoing_charge"), (int, float)):
            descartar("sin gasto corriente"); continue
        if not isinstance(tamano.get("aum"), (int, float)) or tamano["aum"] < PATRIMONIO_MINIMO:
            descartar("menos de 100 M de patrimonio"); continue
        preliminares.append({
            "asset_id": asset_id, "nombre": nombre, "bloque": bloque, "indexado": es_indexado(nombre),
            "gasto_corriente_pct": round(costes["ongoing_charge"] * 100, 4),
            "patrimonio": float(tamano["aum"]), "patrimonio_divisa": tamano.get("currency"),
        })
    raices = lector_de_series.get_assets_many([f["asset_id"] for f in preliminares])
    con_serie = []
    for fondo in preliminares:
        raiz = raices.get(fondo["asset_id"])
        motivo = _root_exclusion_reason(raiz, "EUR", fondo["asset_id"], reader=lector_de_series) if raiz else "PRICE_SERIES_MISSING"
        if motivo:
            descartar("el motor lo excluye"); continue
        fondo["lanzamiento"] = ((raiz or {}).get("product") or {}).get("inception_date")
        try:
            valores = _load_window_values(lector_de_series, fondo["asset_id"], raiz, "10Y")
        except PriceSeriesProblem:
            descartar("sin serie utilizable"); continue
        fondo["serie"] = fin_de_mes(valores)
        # El mes de su último dato puede estar a medias (hoy es día 6): cuenta hasta el anterior, que está completo.
        fondo["ultimo_mes_completo"] = ultimo_mes_completo(valores)
        con_serie.append(fondo)
    if not con_serie:
        raise GeneradorNoDisponible("Ningún fondo de los bloques pasa los filtros.")
    # El último mes completo que tienen la mayoría: un fondo con la serie atrasada no puede fijar la ventana de todos.
    ultimos = [f["ultimo_mes_completo"] for f in con_serie if f.get("ultimo_mes_completo")]
    ultimo_mes = max(set(ultimos), key=lambda mes: (ultimos.count(mes), mes))
    meses = meses_hasta(ultimo_mes, MESES + 1)
    elegibles = []
    for fondo in con_serie:
        fondo["anios"] = _anios_desde(fondo.get("lanzamiento"), ultimo_mes)
        if fondo["anios"] is None:
            descartar("sin fecha de lanzamiento"); continue
        if not llega_al_ultimo_mes(fondo.get("ultimo_mes_completo"), ultimo_mes):
            descartar("serie atrasada"); continue
        if any(mes not in fondo["serie"] for mes in meses):
            descartar("sin 5 años completos de serie"); continue
        fondo["serie"] = {mes: fondo["serie"][mes] for mes in meses}
        elegibles.append(fondo)
    tipo_mensual = estr_mensual(estr_diaria)
    resultado = (elegibles, ultimo_mes, tipo_mensual, fuera)
    with _CERROJO:
        _GUARDADO["elegibles"] = (ahora, resultado)
    return resultado


def estr_mensual(estr_diaria: List[Tuple[date, float]]) -> Callable[[str], float]:
    """El €STR medio de cada mes, en tanto por uno. Antes de octubre de 2019 no hay €STR: se usa su primer mes."""
    por_mes: Dict[str, List[float]] = {}
    for dia, valor in estr_diaria:
        por_mes.setdefault(f"{dia.year:04d}-{dia.month:02d}", []).append(valor / 100)
    if not por_mes:
        raise GeneradorNoDisponible("No hay €STR guardado: sin tipo sin riesgo no se puede medir el Sharpe.")
    medias = {mes: sum(v) / len(v) for mes, v in por_mes.items()}
    primero, ultimo = medias[min(medias)], medias[max(medias)]

    def tipo(mes: str) -> float:
        if mes in medias:
            return medias[mes]
        return primero if mes < min(medias) else ultimo
    return tipo


def generar_borrador(lector_de_activos, lector_de_series, estr_diaria, datos: dict) -> dict:
    """Lo que llama la función invocable: valida la petición, lee lo que haga falta y compone."""
    try:
        nivel = int(datos.get("nivel"))
    except (TypeError, ValueError):
        raise GeneradorNoDisponible("Falta el nivel de riesgo, del 1 al 10.")
    if nivel not in RENTA_VARIABLE_POR_NIVEL:
        raise GeneradorNoDisponible("El nivel de riesgo va del 1 al 10.")
    pedidos = datos.get("num_fondos")
    try:
        num_fondos = FONDOS_POR_DEFECTO if pedidos is None else int(pedidos)
    except (TypeError, ValueError):
        raise GeneradorNoDisponible("El número de fondos tiene que ser un número entero.")
    if not 1 <= num_fondos <= FONDOS_MAXIMOS:
        raise GeneradorNoDisponible(f"El número de fondos va de 1 a {FONDOS_MAXIMOS}.")
    incluir_indexados = datos.get("incluir_indexados") is True
    elegibles, ultimo_mes, tipo_mensual, fuera = cargar_elegibles(lector_de_activos, lector_de_series, estr_diaria)
    return componer(nivel, num_fondos, incluir_indexados, elegibles, ultimo_mes, tipo_mensual, fuera)
