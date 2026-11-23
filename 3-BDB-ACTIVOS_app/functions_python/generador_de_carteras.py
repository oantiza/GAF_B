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

El Sharpe a 3 y 5 años, el Sortino a 5 y la volatilidad a 5 son **los de la ficha** (`computed/metrics`, método propio
mensual, `METODO_PROPIO_METRICAS_2026-11-01.md`): media del exceso mensual sobre el €STR × 12 entre su desviación × √12. Hasta el
20-11-2026 se calculaban aquí con otro estimador (rentabilidad geométrica anual menos €STR medio, entre la volatilidad de las
rentabilidades brutas), y el método prohíbe ordenar cifras de estimador distinto: el asesor veía en la ficha un orden y el
borrador elegía con otro. Solo cuenta la cifra publicada con el método mensual y cerrada en el mismo mes que la ventana del
borrador; otra, de otro mes o de otro método, cuenta como que falta (el percentil la deja en el centro), y la respuesta dice
cuántos candidatos tienen alguna así. La consistencia sí se calcula aquí, con la serie que usa el motor (la misma que Simular,
con sus recortes del histórico) llevada a fin de mes: la ficha no la publica. El ratio de información y el alfa NO entran: los
tienen la mitad de los fondos y medidos contra referencias distintas.

**Lo que no promete.** La prueba fuera de muestra (octubre de 2021, 2022 y 2023, tres años después) dejó a los elegidos de todas las
reglas cerca de la mitad de su grupo: ninguna elige de forma fiable los fondos que irán mejor. Es un borrador para empezar, con su
aviso, y no una recomendación.

**Qué entra.** Solo fondos (los ETF no se traspasan); por defecto, solo gestión activa (`incluir_indexados` los deja entrar); en
euros, de acumulación, con gasto corriente, con 100 M o más de patrimonio, con fecha de lanzamiento, que el motor no excluya y con 5
años completos de serie. El patrimonio se compara en euros: el que viene en otra divisa se convierte con el cambio del BCE de
su fecha (el mismo con el que se pasan a euros las series, decisión 10), y el que no dice su divisa, o no tiene cambio, se queda
fuera con su motivo. Ningún fondo por encima del 25 % ni por debajo del 5 %. El número de fondos lo pide el asesor; cada nivel
tiene un mínimo (`minimo_de_fondos`) para no saltarse el tope ni deformar el riesgo del nivel juntando partes distintas.

Solo con la base nueva: la vieja no guarda el patrimonio de los fondos.
"""

from __future__ import annotations

import math
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Callable, Dict, Iterable, List, Optional, Tuple

METODO = "GENERADOR_V2"

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
# Lo que se lee de la serie de cada candidato: el motor la recorta a 10 años y el borrador usa 61 meses de ella (`MESES + 1`).
VENTANA_DE_LECTURA = "10Y"
LECTURAS_EN_PARALELO = 6
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


# Las cifras de la ficha con las que se puntua la calidad: nombre en el borrador -> (campo de `computed/metrics`, ventana).
CIFRAS_DE_LA_FICHA = {"sharpe_3a": ("sharpe", "3y"), "sharpe_5a": ("sharpe", "5y"),
                      "sortino_5a": ("sortino", "5y"), "volatilidad_5a": ("volatility", "5y")}
METODO_DE_LA_FICHA = "EXTRACTOR_MONTHLY_"


def cifras_de_la_ficha(metricas: Optional[dict], ultimo_mes: str) -> Dict[str, Optional[float]]:
    """Las cifras publicadas que puntuan la calidad, o None en cada una que no sirva.

    Sirve la del método mensual propio cerrada en el mes del borrador: una cifra de otro mes mide otra ventana, y comparar
    ventanas distintas es tan incoherente como comparar estimadores distintos."""
    metricas = metricas or {}
    vale = str(metricas.get("method") or "").startswith(METODO_DE_LA_FICHA) and str(metricas.get("as_of") or "")[:7] == ultimo_mes
    salida: Dict[str, Optional[float]] = {}
    for nombre, (campo, ventana) in CIFRAS_DE_LA_FICHA.items():
        valor = (metricas.get(campo) or {}).get(ventana) if vale else None
        salida[nombre] = float(valor) if isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor) else None
    return salida


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


def puntuar(fondos: List[dict], meses: List[str]) -> Dict[str, dict]:
    """Los cuatro pilares y la nota de cada fondo, frente a los demás de la lista (que son los de un mismo bloque).

    La calidad sale de las cifras de la ficha (`fondo["ficha"]`, de `cifras_de_la_ficha`)."""
    ficha = {f["asset_id"]: f.get("ficha") or {} for f in fondos}
    sostenida = consistencia({f["asset_id"]: f["serie"] for f in fondos}, meses)
    ids = [f["asset_id"] for f in fondos]
    por_id = {f["asset_id"]: f for f in fondos}

    def columna(funcion):
        return [funcion(i) for i in ids]

    salida = {}
    for i in ids:
        calidad = statistics.mean([
            percentil(columna(lambda j, c=campo: ficha[j].get(c)), ficha[i].get(campo), True)
            for campo in ("sharpe_3a", "sharpe_5a", "sortino_5a")
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
                **{campo: ficha[i].get(campo) for campo in CIFRAS_DE_LA_FICHA},
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
             fuera: Dict[str, int]) -> dict:
    """El borrador con los fondos ya elegibles (cada uno con su `serie` a fin de mes). Puro: no lee ninguna base."""
    meses = meses_hasta(ultimo_mes, MESES + 1)
    por_bloque: Dict[str, List[dict]] = {bloque: [] for bloque in BLOQUES}
    for fondo in elegibles:
        if incluir_indexados or not fondo["indexado"]:
            por_bloque[fondo["bloque"]].append(fondo)
    notas: Dict[str, dict] = {}
    for bloque, fondos in por_bloque.items():
        if fondos:
            notas.update(puntuar(fondos, meses))
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
        # De dónde sale la calidad, y cuántos candidatos no tienen alguna de sus cifras en la ficha de este mes.
        "calidad_desde": f"computed/metrics de la ficha, método mensual propio, cerrado en {ultimo_mes}",
        "candidatos_sin_cifra_de_la_ficha": sum(
            1 for fondos in por_bloque.values() for f in fondos
            if any((f.get("ficha") or {}).get(c) is None for c in ("sharpe_3a", "sharpe_5a", "sortino_5a"))),
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
    """Los pesos van redondeados a dos decimales; la diferencia con 100 se lleva a la mayor posición a la que le cabe, para que
    sumen 100 exactos sin pasar del 25 % ni bajar del 5 % (P2-07: llevarla siempre a la mayor dejaba un 25,01 %).

    Si a ninguna le cabe no se rompe el tope en silencio: no hay borrador."""
    if not posiciones:
        return
    diferencia = round(100 - sum(p["peso_pct"] for p in posiciones), 2)
    if diferencia:
        tope, suelo = round(TOPE_POR_FONDO * 100, 2), round(MINIMO_POR_POSICION * 100, 2)
        caben = [p for p in posiciones if suelo <= round(p["peso_pct"] + diferencia, 2) <= tope]
        if not caben:
            raise GeneradorNoDisponible("Los pesos no se pueden cuadrar a 100 sin pasar del 25 % o bajar del 5 % en algún fondo.")
        elegida = max(caben, key=lambda p: p["peso_pct"])
        elegida["peso_pct"] = round(elegida["peso_pct"] + diferencia, 2)


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


def patrimonio_en_euros(tamano: dict, cambios_de: Callable[[str], list]) -> Tuple[Optional[float], Optional[str]]:
    """(patrimonio en euros, None) o (None, motivo por el que no se puede comparar con los 100 M).

    `cambios_de(divisa)` da [(fecha, divisa por euro), ...] del BCE, en orden: los mismos con los que se pasan a euros las
    series (decisión 10). Se usa el último en o antes de la fecha del patrimonio, con la tolerancia de los festivos de TARGET;
    sin cambio no se inventa uno. Una divisa en centésimos (GBX) se pide con su divisa mayor, y se escala."""
    from readmodel.lector_base_nueva import MONEDAS_MENORES, TOLERANCIA_CAMBIO_DIAS
    aum = tamano.get("aum")
    divisa = tamano.get("currency")
    if not isinstance(aum, (int, float)) or isinstance(aum, bool) or not math.isfinite(aum):
        return None, "sin patrimonio"
    if not isinstance(divisa, str) or not divisa.strip():
        return None, "patrimonio sin divisa"
    if divisa == "EUR":
        return float(aum), None
    fecha = str(tamano.get("as_of") or "")[:10]
    try:
        dia = date.fromisoformat(fecha)
    except ValueError:
        return None, "patrimonio en otra divisa sin fecha"
    moneda, escala = MONEDAS_MENORES.get(divisa, (divisa, 1.0))
    cambios = [(c, v) for c, v in (cambios_de(moneda) or []) if c <= fecha]
    if not cambios or not cambios[-1][1] or (dia - date.fromisoformat(cambios[-1][0])).days > TOLERANCIA_CAMBIO_DIAS:
        return None, "patrimonio en otra divisa sin cambio del BCE"
    return float(aum) * escala / cambios[-1][1], None


def cargar_elegibles(lector_de_activos, lector_de_series) -> Tuple[List[dict], str, Dict[str, int]]:
    """Los fondos que pueden entrar (indexados incluidos, marcados), el último mes común y cuántos quedan fuera por cada motivo.

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
        en_euros, sin_euros = patrimonio_en_euros(tamano, lector_de_series.get_ecb_fx_points)
        if sin_euros:
            descartar(sin_euros); continue
        if en_euros < PATRIMONIO_MINIMO:
            descartar("menos de 100 M de patrimonio"); continue
        fondo = {
            "asset_id": asset_id, "nombre": nombre, "bloque": bloque, "indexado": es_indexado(nombre),
            "gasto_corriente_pct": round(costes["ongoing_charge"] * 100, 4),
            "patrimonio": en_euros, "patrimonio_divisa": "EUR", "metricas": metricas,
        }
        if tamano.get("currency") != "EUR":
            fondo["patrimonio_en_origen"] = {"valor": float(tamano["aum"]), "divisa": tamano["currency"]}
        preliminares.append(fondo)
    raices = lector_de_series.get_assets_many([f["asset_id"] for f in preliminares])
    aptos = []
    for fondo in preliminares:
        raiz = raices.get(fondo["asset_id"])
        motivo = _root_exclusion_reason(raiz, "EUR", fondo["asset_id"], reader=lector_de_series) if raiz else "PRICE_SERIES_MISSING"
        if motivo:
            descartar("el motor lo excluye"); continue
        fondo["lanzamiento"] = ((raiz or {}).get("product") or {}).get("inception_date")
        aptos.append((fondo, raiz))

    # P1-12: la serie de cada fondo se leia de uno en uno. Se leen hasta seis a la vez, y los resultados se recorren en el orden de
    # siempre, asi que lo que sale y lo que se descarta no cambia. No se acorta lo que se lee: la ventana "10Y" solo recorta en
    # memoria lo que `get_price_series` ya trajo entero (la subcoleccion `price_series`, un documento por año) y que comparte la
    # cache de series con Simular y el backtest; leer menos años aqui dejaria en esa cache una serie corta para los demas.
    def _leer_serie(par):
        try:
            return _load_window_values(lector_de_series, par[0]["asset_id"], par[1], VENTANA_DE_LECTURA)
        except PriceSeriesProblem as problema:
            return problema

    if len(aptos) > 1:
        with ThreadPoolExecutor(max_workers=min(LECTURAS_EN_PARALELO, len(aptos))) as pool:
            leidas = list(pool.map(_leer_serie, aptos))
    else:
        leidas = [_leer_serie(par) for par in aptos]
    con_serie = []
    for (fondo, _raiz), valores in zip(aptos, leidas):
        if isinstance(valores, PriceSeriesProblem):
            descartar("sin serie utilizable"); continue
        fondo["serie"] = fin_de_mes(valores)
        # El mes de su último dato puede estar a medias (hoy es día 6): cuenta hasta el anterior, que está completo.
        fondo["ultimo_mes_completo"] = ultimo_mes_completo(valores)
        con_serie.append(fondo)
    if not con_serie:
        raise GeneradorNoDisponible("Ningún fondo de los bloques pasa los filtros.")
    # El último mes completo que tienen la mayoría: un fondo con la serie atrasada no puede fijar la ventana de todos.
    ultimos = [f["ultimo_mes_completo"] for f in con_serie if f.get("ultimo_mes_completo")]
    if not ultimos:
        raise GeneradorNoDisponible("Ningún fondo de los bloques tiene un mes completo de serie.")
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
        fondo["ficha"] = cifras_de_la_ficha(fondo.pop("metricas", None), ultimo_mes)
        elegibles.append(fondo)
    resultado = (elegibles, ultimo_mes, fuera)
    with _CERROJO:
        _GUARDADO["elegibles"] = (ahora, resultado)
    return resultado


def generar_borrador(lector_de_activos, lector_de_series, datos: dict) -> dict:
    """Lo que llama la función invocable: valida la petición, lee lo que haga falta y compone."""
    try:
        if isinstance(datos.get("nivel"), bool):  # `int(True)` es 1: un booleano no es un nivel
            raise TypeError
        nivel = int(datos.get("nivel"))
    except (TypeError, ValueError):
        raise GeneradorNoDisponible("Falta el nivel de riesgo, del 1 al 10.")
    if nivel not in RENTA_VARIABLE_POR_NIVEL:
        raise GeneradorNoDisponible("El nivel de riesgo va del 1 al 10.")
    pedidos = datos.get("num_fondos")
    try:
        if isinstance(pedidos, bool):
            raise TypeError
        num_fondos = FONDOS_POR_DEFECTO if pedidos is None else int(pedidos)
    except (TypeError, ValueError):
        raise GeneradorNoDisponible("El número de fondos tiene que ser un número entero.")
    if not 1 <= num_fondos <= FONDOS_MAXIMOS:
        raise GeneradorNoDisponible(f"El número de fondos va de 1 a {FONDOS_MAXIMOS}.")
    incluir_indexados = datos.get("incluir_indexados") is True
    elegibles, ultimo_mes, fuera = cargar_elegibles(lector_de_activos, lector_de_series)
    return componer(nivel, num_fondos, incluir_indexados, elegibles, ultimo_mes, fuera)
