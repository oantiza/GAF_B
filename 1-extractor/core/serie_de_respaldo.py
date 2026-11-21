"""La serie de VL de un fondo cuando la de EODHD se para: Morningstar, con las reglas de D-9.

Decisión D-9 de Óscar (11-11-2026, `DECISIONES_ADQUISICION_2026-10-30.md`). Matiza D1 sin
cambiarla: EODHD sigue siendo la fuente del valor liquidativo, y Morningstar entra **solo**
cuando EODHD está parado: con la regla declarada para los fondos de
`config/serie_de_respaldo.json`, y desde D-10 para cualquier otro que cumpla sus salvaguardas
(abajo). Un fondo parado que no cumpla alguna sigue parado, con su aviso.

Tres reglas, y las tres viven aquí:

- **Empalme**: los puntos de EODHD hasta el último día en que coinciden con Morningstar, y los de
  Morningstar después. Sin salto de nivel: antes de empalmar se comprueba que las dos cuadran en
  el solape anterior al corte (`cuadra_de_nivel`). Si no cuadran, no se empalma.
  - **El tramo de EODHD se cierra en su último día común con Morningstar** (Óscar, 11-11-2026, al
    aceptar la recomendación sobre LU1683285321): un último dato erróneo de EODHD no queda en el
    empalme. Coincidir es diferir como mucho `TOLERANCIA_NIVEL` ese mismo día.
  - **Sus huecos se rellenan con Morningstar**, el mismo día: un hueco es lo que el método llama
    así, más de `metricas.HUECO_MAXIMO_DIAS_DIARIO` días seguidos sin un punto (decisión 111), y se
    rellena solo si las dos cuadran a los dos lados, con la misma prueba de nivel sobre los días
    comunes de antes y de después. Si no cuadran, el hueco se queda como está, y el método lo
    sigue contando. Cada punto rellenado es un tramo de Morningstar: una serie puede tener más de
    dos tramos.
- **Sustitución**: la serie entera de Morningstar, sin un punto de EODHD. La misma comprobación
  de nivel, que aquí guarda de otra cosa: pedir a Morningstar una divisa que no es la de la
  clase devuelve la serie convertida, y eso no se ve en la forma de la serie.
- **Corte en el evento**: no se hace aquí, y no se escribe fondo a fondo ni con fecha. La serie
  se publica entera, como la de cualquier fondo, y el corte lo hace la regla de ruptura del
  método (`metricas.tramo_sin_rupturas`: un VL que se multiplica o divide por más de 2,0 de un
  día al siguiente), que `vl_fondos` ya aplica antes de calcular y deja escrita en
  `aviso_serie`. En las dos Schroder ISF Emerging Europe cae el 18-07-2022, el día que su VL
  pasó de 25,50 a 10,29 y de 24,17 a 9,7501, y por eso sus métricas solo miden desde ese día.
  Para quien use la serie fuera del cálculo (la simulación de carteras, la tarjeta) la fecha
  desde la que vale se declara donde se declaran todas, `usable_from` en
  `functions_python/fund_history_policies.json` de la app. Dirección, 11-11-2026: no se borra
  ningún año de `price_series`, y cortar la serie publicada dejaba 2000-2021 sin nadie que los
  produjera.

Cada punto sabe de qué fuente sale: la serie va con sus `tramos`, contiguos y en orden, cada
uno con su fuente, su serie y sus fechas. `export_series` la reconstruye desde ellos.

Si Morningstar no contesta, no trae puntos, no cuadra o tampoco está viva (`vl_fondos`), el fondo
se queda como estaba: serie
de EODHD parada y su aviso. Nada pasa a depender de que responda (D3).

**D-10, el respaldo automático** (Dirección, 11-11-2026, por encargo de Óscar). Un fondo parado
que no está en la lista también sigue con Morningstar si cumple **todas** las salvaguardas:

1. Es un fondo de valor liquidativo (`{ISIN}.EUFUND`): `vl_fondos` solo llega aquí desde esa
   rama. Ni acciones ni ETF, que van a precio de mercado.
2. Su serie de EODHD está parada, con la regla de siempre (`vl_fondos.MAX_DIAS_SERIE`).
3. Su SecId de Morningstar es conocido (`sec_id_de`), y la divisa en que pedirlo también.
4. Morningstar llega más lejos que EODHD, y está viva con la misma regla de `dias_parada`.
5. El nivel cuadra: la misma prueba de D-9 (`cuadra_de_nivel`), con las mismas constantes.
6. La serie compuesta no tiene ninguna ruptura del método (`metricas.tramo_sin_rupturas`). Si la
   tiene, no se aplica: el fondo queda como estaba y la traza lo deja para decidir
   (`respaldo_pendiente`, «ruptura: requiere decisión»), como las Schroder de D-9.
7. La regla es siempre la de **empalme**, con el cierre en el último día común y el relleno de
   huecos. La sustitución y el corte en un evento siguen siendo decisiones por fondo, en la lista.

La lista manda: un fondo de la lista usa su regla, y si no se puede aplicar se queda como estaba,
sin probar el automático. Un fondo en `excluidos_del_automatico` (con su motivo y su fecha) no
entra nunca por el automático. Cada fondo parado queda anotado en la sesión de la pasada
(`anota`), y `resumen` cuenta cuántos entraron por la lista, cuántos por el automático y cuántos
se quedaron fuera, por qué salvaguarda.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import statistics
from datetime import date
from pathlib import Path

from core import metricas
from fetchers import morningstar_series

log = logging.getLogger("fondosdb.serie_de_respaldo")

CONFIG = Path("config") / "serie_de_respaldo.json"
DECISION = "D-9"
DECISION_AUTOMATICO = "D-10"
ETIQUETA_AUTOMATICO = "respaldo automático D-10"
REGLA_AUTOMATICO = "empalme"
REGLAS = ("empalme", "sustitucion")

# Por dónde entra un fondo parado, y lo que le pasó. Es el vocabulario del resumen de la pasada.
VIA_LISTA, VIA_AUTOMATICO, VIA_EXCLUIDO = "lista", "automatico", "excluido"
APLICADO = "aplicado"
SIN_SECID = "sin_secid"
SIN_DIVISA = "sin_divisa"
MS_NO_RESPONDE = "morningstar_no_responde"
MS_NO_LLEGA_MAS_LEJOS = "morningstar_no_llega_mas_lejos"
MS_PARADA = "morningstar_parada"
NIVEL_NO_CUADRA = "nivel_no_cuadra"
RUPTURA = "ruptura_requiere_decision"
EN_EXCLUIDOS = "excluido_del_automatico"
REGLA_DESCONOCIDA = "regla_desconocida"
TEXTO_RUPTURA = "ruptura: requiere decisión"
FUENTE_EODHD = "eodhd"
PREFIJO_EODHD = "EODHD:"

# El nivel se compara en los últimos días que las dos fuentes tienen en común antes del corte de
# EODHD. Con la mediana: un día malo de una de las dos no tumba el empalme (en LU1683285321 el
# último punto de EODHD es uno de sus dos errores, un 2,5 % por debajo), y un cambio de divisa o
# de clase sí, porque mueve todos los días. Medido el 11-11-2026 en los once: mediana como mucho
# 0,002 %; un 0,1 % es cincuenta veces eso y veinte veces menos que el cambio EUR/USD de un día malo.
SOLAPE_DIAS = 60
SOLAPE_MINIMO = 20
TOLERANCIA_NIVEL = 0.001


@dataclasses.dataclass(frozen=True)
class Tramo:
    fuente: str
    serie: str
    desde: date
    hasta: date
    puntos: int

    def como_dict(self) -> dict:
        return {"fuente": self.fuente, "serie": self.serie, "desde": self.desde.isoformat(),
                "hasta": self.hasta.isoformat(), "puntos": self.puntos}


@dataclasses.dataclass
class Compuesta:
    serie: metricas.Serie
    tramos: list[Tramo]
    regla: str
    divisa: str
    eodhd_hasta: date
    fetched_at: float | None
    # La prueba de nivel que la dejó pasar, con su mediana y sus días comunes.
    nivel: str = ""
    # D-10: el fondo no está en la lista y entró porque cumple todas las salvaguardas.
    automatico: bool = False

    @property
    def listing_id(self) -> str:
        """`EODHD:<símbolo>+MORNINGSTAR:<SecId>`, o la de la única fuente que queda.

        Cada serie una vez y en el orden en que aparece: con un hueco rellenado los tramos son
        EODHD, Morningstar, EODHD y Morningstar, y la serie sigue siendo la de esos dos listados."""
        return "+".join(dict.fromkeys(t.serie for t in self.tramos))

    @property
    def source_history(self) -> str:
        return "+".join(dict.fromkeys(t.fuente for t in self.tramos))

    @property
    def solo_morningstar(self) -> bool:
        return all(t.fuente == morningstar_series.FUENTE for t in self.tramos)


def _tabla(base: Path | None) -> dict:
    if base is None:
        return {}
    try:
        tabla = json.loads((Path(base) / CONFIG).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return tabla if isinstance(tabla, dict) else {}


def declarados(base: Path | None) -> dict:
    """Los fondos de `config/serie_de_respaldo.json`; vacío si no está o no se entiende."""
    fondos = _tabla(base).get("fondos")
    return fondos if isinstance(fondos, dict) else {}


def excluidos(base: Path | None) -> dict:
    """Los fondos que no entran nunca por el automático de D-10, cada uno con su motivo y su fecha.

    Una entrada sin motivo o sin fecha excluye igual, porque excluir es lo prudente, pero se avisa:
    una exclusión que no dice por qué no se puede revisar."""
    tabla = _tabla(base).get("excluidos_del_automatico")
    if not isinstance(tabla, dict):
        return {}
    for isin, entrada in tabla.items():
        if not isinstance(entrada, dict) or not entrada.get("motivo") or not entrada.get("fecha"):
            log.warning("%s: excluido del respaldo automatico sin motivo o sin fecha en %s", isin, CONFIG)
    return tabla


def via_de(isin: str, base: Path | None) -> tuple[str, str | None]:
    """(por dónde entra el fondo, regla): la lista con su regla, el automático con el empalme, o
    excluido. La lista va delante: un fondo declarado usa su regla aunque también esté excluido.
    Un fondo en la lista con una regla que no se entiende no cae al automático: alguien lo declaró,
    y lo que dijo no se adivina."""
    clave = isin.strip().upper()
    if clave in declarados(base):
        return VIA_LISTA, regla_de(clave, base)
    if clave in excluidos(base):
        return VIA_EXCLUIDO, None
    return VIA_AUTOMATICO, REGLA_AUTOMATICO


def regla_de(isin: str, base: Path | None) -> str | None:
    """La regla declarada para el fondo, o None si no está en la lista."""
    entrada = declarados(base).get(isin.strip().upper())
    if not isinstance(entrada, dict):
        return None
    regla = entrada.get("regla")
    if regla not in REGLAS:
        log.warning("%s: regla de respaldo desconocida %r en %s; no se aplica", isin, regla, CONFIG)
        return None
    return regla


def sec_id_de(previo: dict | None) -> str | None:
    """El SecId que resolvió el buscador de Morningstar: el de esta pasada antes que el anterior."""
    previo = previo or {}
    fichas = [d for k, d in previo.items() if isinstance(d, dict) and k != "_anterior"]
    if isinstance(previo.get("_anterior"), dict):
        fichas.append(previo["_anterior"])
    for d in fichas:
        sec = str(((d.get("meta") or {}).get("sec_id_morningstar")) or "").strip()
        if sec:
            return sec
    return None


def divisa_declarada(previo: dict | None) -> str | None:
    """La divisa del VL de la clase que publica Morningstar en la ficha, si EODHD ya no la dice.

    Medido el 11-11-2026: el buscador de EODHD devuelve `[]` para los once, porque ya no los
    lista, así que la divisa de la clase no sale de ahí. `valoracion.vl_divisa` es la del VL que
    Morningstar publica para la clase (su ficha, `LastPrice.Currency`), la misma casa que la serie.
    No se supone: si no la hay, no se pide nada. Y la prueba de nivel contra EODHD, que está en la
    divisa de la clase, para un empalme pedido en otra divisa."""
    previo = previo or {}
    fichas = [d for k, d in previo.items() if isinstance(d, dict) and k != "_anterior"]
    if isinstance(previo.get("_anterior"), dict):
        fichas.append(previo["_anterior"])
    for d in fichas:
        div = str(((d.get("valoracion") or {}).get("vl_divisa")) or "").strip().upper()
        if len(div) == 3 and div.isalpha():
            return div
    return None


def cuadra_de_nivel(eodhd: metricas.Serie, ms: metricas.Serie, desde_el_principio: bool = False) -> tuple[bool, str]:
    """¿Dicen lo mismo las dos fuentes en los últimos días comunes antes del corte de EODHD?

    Con `desde_el_principio`, en los primeros: es el lado de después de un hueco."""
    del_ms = dict(ms)
    todos = [(f, p) for f, p in eodhd if f in del_ms]
    comunes = todos[:SOLAPE_DIAS] if desde_el_principio else todos[-SOLAPE_DIAS:]
    if len(comunes) < SOLAPE_MINIMO:
        return False, f"solo {len(comunes)} dias comunes en el solape (hacen falta {SOLAPE_MINIMO})"
    mediana = statistics.median(abs(del_ms[f] / p - 1) for f, p in comunes)
    if mediana > TOLERANCIA_NIVEL:
        return False, f"mediana de la diferencia {mediana:.4%} en los ultimos {len(comunes)} dias comunes"
    return True, f"mediana {mediana:.4%} en {len(comunes)} dias comunes"


def coincide(p_eodhd: float, p_ms: float | None) -> bool:
    """El mismo día, el mismo valor liquidativo salvo redondeo."""
    return p_ms is not None and abs(p_ms / p_eodhd - 1) <= TOLERANCIA_NIVEL


def ultimo_dia_comun(eodhd: metricas.Serie, ms: metricas.Serie) -> date | None:
    """El último día de EODHD en que Morningstar da el mismo valor. Ahí se cierra su tramo."""
    del_ms = dict(ms)
    return next((f for f, p in reversed(eodhd) if coincide(p, del_ms.get(f))), None)


def rellenos(eodhd: metricas.Serie, ms: metricas.Serie) -> list[tuple[date, float]]:
    """Los puntos de Morningstar que tapan los huecos de EODHD, solo donde cuadran a los dos lados."""
    salida: list[tuple[date, float]] = []
    for (a, _pa), (b, _pb) in zip(eodhd, eodhd[1:]):
        # 31 días, los de la decisión 111: la versión 4 sube a 33 el hueco del método mensual, y esto no lo sigue a
        # propósito. Rellenar un hueco de 32 días con datos que cuadran no quita ninguna cifra.
        if (b - a).days <= metricas.HUECO_MAXIMO_DIAS_DIARIO:
            continue
        dentro = [(f, p) for f, p in ms if a < f < b]
        if not dentro:
            continue
        antes, _ = cuadra_de_nivel([x for x in eodhd if x[0] <= a], ms)
        despues, _ = cuadra_de_nivel([x for x in eodhd if x[0] >= b], ms, desde_el_principio=True)
        if antes and despues:
            salida += dentro
        else:
            log.info("hueco de EODHD del %s al %s: Morningstar no cuadra alrededor; se queda como esta", a, b)
    return salida


def _tramos(puntos: list[tuple[date, float, str, str]]) -> list[Tramo]:
    tramos: list[Tramo] = []
    for f, _p, fuente, serie in puntos:
        if tramos and tramos[-1].serie == serie:
            ultimo = tramos[-1]
            tramos[-1] = dataclasses.replace(ultimo, hasta=f, puntos=ultimo.puntos + 1)
        else:
            tramos.append(Tramo(fuente, serie, f, f, 1))
    return tramos


def compone(regla: str, eodhd: metricas.Serie, sim_eodhd: str, ms: metricas.Serie, sec_id: str,
            divisa: str, fetched_at: float | None = None) -> Compuesta | None:
    """La serie compuesta según la regla, o None si no se puede componer sin inventar nada."""
    return compone_con_motivo(regla, eodhd, sim_eodhd, ms, sec_id, divisa, fetched_at)[0]


def compone_con_motivo(regla: str, eodhd: metricas.Serie, sim_eodhd: str, ms: metricas.Serie, sec_id: str,
                       divisa: str, fetched_at: float | None = None) -> tuple[Compuesta | None, str, str]:
    """Lo mismo que `compone`, con la salvaguarda que la paró y su detalle: (compuesta, motivo, detalle)."""
    if regla not in REGLAS:
        return None, REGLA_DESCONOCIDA, f"regla {regla!r}"
    if not eodhd or not ms:
        return None, MS_NO_RESPONDE, "Morningstar sin puntos"
    fin_eodhd = eodhd[-1][0]
    if ms[-1][0] <= fin_eodhd:
        # Morningstar no trae nada después del corte de EODHD: no hay nada que revivir.
        detalle = f"Morningstar acaba el {ms[-1][0].isoformat()} y EODHD el {fin_eodhd.isoformat()}"
        log.info("%s: %s; la serie se queda parada", sec_id, detalle)
        return None, MS_NO_LLEGA_MAS_LEJOS, detalle
    ok, detalle = cuadra_de_nivel(eodhd, ms)
    if not ok:
        log.warning("%s: Morningstar no cuadra con EODHD (%s); la serie se queda parada", sec_id, detalle)
        return None, NIVEL_NO_CUADRA, detalle
    nivel = detalle
    id_eodhd = f"{PREFIJO_EODHD}{sim_eodhd}"
    id_ms = morningstar_series.identificador(sec_id)
    if regla == "empalme":
        cierre = ultimo_dia_comun(eodhd, ms)
        if cierre is None:
            log.warning("%s: EODHD y Morningstar no coinciden ningun dia; la serie se queda parada", sec_id)
            return None, NIVEL_NO_CUADRA, "EODHD y Morningstar no coinciden ningun dia"
        tramo_eodhd = [(f, p) for f, p in eodhd if f <= cierre]
        puntos = [(f, p, FUENTE_EODHD, id_eodhd) for f, p in tramo_eodhd]
        puntos += [(f, p, morningstar_series.FUENTE, id_ms) for f, p in rellenos(tramo_eodhd, ms)]
        puntos.sort(key=lambda x: x[0])
        puntos += [(f, p, morningstar_series.FUENTE, id_ms) for f, p in ms if f > cierre]
    else:
        puntos = [(f, p, morningstar_series.FUENTE, id_ms) for f, p in ms]
    if not puntos or puntos[-1][0] <= fin_eodhd:
        return None, MS_NO_LLEGA_MAS_LEJOS, "la serie compuesta no pasa del corte de EODHD"
    return (Compuesta(serie=[(f, p) for f, p, _x, _y in puntos], tramos=_tramos(puntos), regla=regla,
                      divisa=divisa, eodhd_hasta=fin_eodhd, fetched_at=fetched_at, nivel=nivel),
            APLICADO, nivel)


def respaldo(isin: str, regla: str, eodhd: metricas.Serie, sim_eodhd: str, divisa: str | None,
             previo: dict | None, http, force: bool = False) -> tuple[Compuesta | None, str, str]:
    """Pide la serie a Morningstar y la compone: (compuesta, motivo, detalle).

    Sin compuesta —y el fondo como estaba— si algo falta; el motivo dice qué salvaguarda lo paró."""
    sec_id = sec_id_de(previo)
    if not sec_id:
        log.info("%s: sin SecId de Morningstar en la ficha; la serie se queda parada", isin)
        return None, SIN_SECID, "sin meta.sec_id_morningstar en la ficha"
    if not divisa:
        log.info("%s: sin divisa de la clase; no se pide a Morningstar sin saber en que", isin)
        return None, SIN_DIVISA, "ni EODHD ni la ficha de Morningstar dicen la divisa de la clase"
    try:
        ms, fetched_at = morningstar_series.serie(sec_id, divisa, http, force)
    except ConnectionError as e:
        log.info("%s: Morningstar no responde (%s); la serie se queda parada", isin, e)
        return None, MS_NO_RESPONDE, str(e)
    if not ms:
        return None, MS_NO_RESPONDE, "Morningstar sin serie"
    return compone_con_motivo(regla, eodhd, sim_eodhd, ms, sec_id, divisa, fetched_at)


def ruptura_en(c: Compuesta) -> date | None:
    """La ruptura del método en la serie compuesta, si la hay (salvaguarda 6 de D-10)."""
    return metricas.tramo_sin_rupturas(c.serie)[1]


def pendiente_de_decision(c: Compuesta, ruptura: date) -> dict:
    """Lo que se escribe en la traza de un fondo que el automático deja para decidir."""
    return {"decision": DECISION_AUTOMATICO, "motivo": TEXTO_RUPTURA, "ruptura": ruptura.isoformat(),
            "regla": c.regla, "serie": c.listing_id, "morningstar_hasta": c.serie[-1][0].isoformat(),
            "eodhd_hasta": c.eodhd_hasta.isoformat(), "nivel": c.nivel}


# ------------------------------------------------------------------ el resumen de la pasada
def anota(http, isin: str, via: str, motivo: str, detalle: str = "") -> None:
    """Deja en la sesión HTTP de la pasada lo que le pasó a un fondo parado. Como el €STR de
    `vl_fondos`, vive en la sesión y no en el módulo: una pasada no hereda lo de la anterior."""
    lista = getattr(http, "_respaldo_de_la_pasada", None)
    if lista is None:
        lista = []
        try:
            http._respaldo_de_la_pasada = lista
        except AttributeError:
            return
    lista.append({"isin": isin, "via": via, "motivo": motivo, "detalle": detalle})


def anotados(http) -> list[dict]:
    return list(getattr(http, "_respaldo_de_la_pasada", None) or [])


def cuenta(http) -> dict:
    """Los fondos parados de la pasada: por la lista, por el automático y fuera, por salvaguarda."""
    filas = anotados(http)
    fuera: dict[str, list[str]] = {}
    for f in filas:
        if f["motivo"] != APLICADO:
            fuera.setdefault(f"{f['via']}:{f['motivo']}", []).append(f["isin"])
    return {
        "parados": len(filas),
        "lista": [f["isin"] for f in filas if f["via"] == VIA_LISTA and f["motivo"] == APLICADO],
        "automatico": [f["isin"] for f in filas if f["via"] == VIA_AUTOMATICO and f["motivo"] == APLICADO],
        "fuera": dict(sorted(fuera.items())),
    }


def resumen(http) -> str:
    """El bloque del resumen de la pasada. Vacío si ningún fondo tenía la serie de EODHD parada."""
    c = cuenta(http)
    if not c["parados"]:
        return ""
    n_fuera = sum(len(v) for v in c["fuera"].values())
    lineas = [f"Serie de respaldo (D-9 y D-10): {c['parados']} fondos con la serie de EODHD parada",
              f"   por la lista (D-9)          {len(c['lista']):>4}",
              f"   por el automatico (D-10)    {len(c['automatico']):>4}"
              + (f"   {', '.join(c['automatico'])}" if c["automatico"] else ""),
              f"   fuera                       {n_fuera:>4}"]
    for clave, isins in c["fuera"].items():
        lineas.append(f"      {clave:<42} {len(isins):>3}   {', '.join(isins)}")
    return "\n".join(lineas)


def reconstruye(tramos: list[dict], divisa: str | None, http, token: str) -> tuple[metricas.Serie, float | None]:
    """La serie compuesta desde sus tramos y la caché, para exportarla sin red.

    Lanza `SinCache` si falta una de las respuestas: quien exporta lo cuenta. Un tramo cuyo
    número de puntos no cuadre con la fuente deja la serie como sale, y la comparación con la
    traza de la ficha (`export_series.compara_traza`) lo señala."""
    from fetchers import vl_fondos

    serie: metricas.Serie = []
    descargada: float | None = None
    for tramo in tramos:
        ident = str(tramo.get("serie") or "")
        desde, hasta = str(tramo.get("desde") or ""), str(tramo.get("hasta") or "")
        if ident.startswith(PREFIJO_EODHD):
            puntos, at = vl_fondos.serie_de_simbolo(ident[len(PREFIJO_EODHD):], http, token)
        elif ident.startswith(morningstar_series.PREFIJO) and divisa:
            puntos, at = morningstar_series.serie(ident[len(morningstar_series.PREFIJO):], divisa, http)
        else:
            return [], None
        serie += [(f, p) for f, p in puntos if desde <= f.isoformat() <= hasta]
        if at is not None:
            descargada = at if descargada is None else max(descargada, at)
    return metricas.normaliza(serie), descargada
