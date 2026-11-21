"""Núcleo de adquisición: una sola vía para obtener la ficha v2 de un activo.

Ejecuta el plan (adaptadores en orden), atribuye cada hoja a quien la escribió,
fusiona por prioridad con la regla de frescura, retiene lo que la fuente dejó
de traer (`retencion`, con la ficha anterior) y aplica el saneado de siempre
(limpieza, derivados, FIGI, calidad), atribuyendo lo que estos crean a
`derivado:<paso>`. Devuelve el dict v2 listo para guardar.

Lo llaman `core.update` (CLI e interfaz web) y cualquier cliente futuro; la
recolección no debe reimplementarse en otro sitio (descubrimiento 04-09, §7.4).
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import logging
import time
from typing import Callable

from core import bajas_decididas, calidad, correcciones, derivados, figi, limpieza
from core.adquisicion import alcance as alcance_mercados
from core.adquisicion import disponibilidad, procedencia, registro, retencion
from core.adquisicion.adaptador import Adaptador, Contexto
from core.adquisicion.planificador import Plan, planifica
from core.http import SinCache, sin_claves
from core.schema import cuenta_campos, merge

log = logging.getLogger("fondosdb.nucleo")

PASOS_DERIVADOS: tuple[tuple[str, Callable[[dict], None]], ...] = (
    ("limpieza", limpieza.aplica),
    ("derivados", derivados.aplica),
)


@dataclasses.dataclass
class Resultado:
    datos: dict
    parciales: list[tuple[str, dict]]
    errores: list[str]
    detalle: dict[str, dict]     # id adaptador -> {"hojas": n, "endpoints": {...}, "segundos": s}
    plan: Plan


def adquiere(isin: str, tipo: str, ctx: Contexto, adaptadores: list[Adaptador],
             fuentes_activas: list[str] | None = None,
             familias: set[str] | None = None,
             print_cb: Callable[[str], None] | None = None,
             anterior: dict | None = None) -> Resultado:
    """`anterior` es la ficha v2 ya guardada del activo, si existe: viaja a los
    adaptadores como pista `_anterior` (p.ej. el nombre con el que ESMA busca
    cuando Morningstar no responde). No entra en la fusión, pero tras ella el
    paso de retención conserva de ella lo que la fuente dejó de traer, con sus
    reglas y su procedencia `retenido:` (ver `core.adquisicion.retencion`)."""
    plan = planifica(isin, tipo, adaptadores, fuentes_activas, familias)
    parciales: list[tuple[str, dict]] = []
    procedencias: dict[str, dict[str, str]] = {}
    detalle: dict[str, dict] = {}
    errores: list[str] = []
    sin_servir: dict[str, dict[str, float | None]] = {}
    aportado: dict[str, dict] = {"_anterior": anterior} if anterior else {}
    contestaciones: dict[str, bool | None] = {}
    sucesores: dict[str, str] = {}

    for a in plan.adaptadores:
        ctx_a = dataclasses.replace(ctx, tipo=tipo, previo=aportado)
        t0 = time.monotonic()
        datos: dict = {}
        with procedencia.activa(a.id) as reg:
            try:
                datos = a.fetch(isin, ctx_a) or {}
            except SinCache as e:
                log.info("%s %s: sin caché (modo sin red): %s", a.id, isin, e)
                datos = {}
            except Exception as e:  # noqa: BLE001 - una fuente caída no tumba la ficha
                # EXT-5: el error se guarda en la ficha y sale en la exportación; sin claves.
                motivo = sin_claves(e)
                errores.append(f"{a.id}: {motivo}")
                log.error("%s %s: %s", a.id, isin, motivo)
                if print_cb:
                    print_cb(f"   {a.id:<15} ERROR      {motivo}")
                continue
            finally:
                # En el `finally` a propósito: el `continue` de arriba sale del `with`, y
                # una fuente que se cayó es justo el caso en que la contestación importa.
                contestaciones[a.id] = reg.contesto
                if reg.sucesor:
                    sucesores[a.id] = reg.sucesor
        if reg.no_servidos:
            # Lo que el adaptador avisó de que no pudo servir sin red: la
            # retención solo conserva eso (MEN-A), aunque no haya traído nada más.
            sin_servir[a.id] = dict(reg.no_servidos)
        con, _ = cuenta_campos(datos)
        if print_cb:
            print_cb(f"   {a.id:<15} {'OK' if datos else 'sin datos':<10} {con} campos")
        if not datos:
            continue
        parciales.append((a.id, datos))
        aportado[a.id] = datos
        procedencias[a.id] = {ruta: reg.resuelve(ruta) for ruta, _v in procedencia.hojas(datos)}
        detalle[a.id] = {"hojas": con, "endpoints": reg.endpoints,
                         "segundos": round(time.monotonic() - t0, 2)}

    contraste = aplica_contraste(parciales, procedencias)

    tipo_csv = str(tipo or "").strip().lower()
    if tipo_csv:
        parciales.append(("config_csv", {"identificacion": {"tipo": tipo_csv}}))
    prioridad = list(dict.fromkeys([
        *ctx.settings.get("prioridad_fuentes", []),
        *(fuente for fuente, _d in parciales if fuente != "config_csv"),
        "config_csv",
    ]))
    oficiales = [a.id for a in plan.adaptadores if a.oficial and a.id in dict(parciales)]
    prioridad_por_ruta = {ruta: oficiales + [f for f in prioridad if f not in oficiales]
                          for ruta in registro.RUTAS_OFICIAL_PRIMERO}
    final = merge(parciales, prioridad, isin, procedencias, prioridad_por_ruta,
                  desempate_frescura=registro.DESEMPATE_FRESCURA.get(tipo_csv, ()))
    final["meta"]["errores"] = errores
    if contraste:
        final["meta"]["contraste"] = contraste
    final["meta"]["adquisicion"] = {
        "plan": plan.ids(),
        "familias": sorted(familias) if familias else "todas",
        "fuentes": detalle,
    }
    # Antes del saneado: lo derivado (p.ej. %IG/%HY) y la calidad se calculan
    # ya con lo retenido.
    if sin_servir:
        final["meta"]["adquisicion"]["sin_servir"] = {
            fuente: sorted(endpoints) for fuente, endpoints in sin_servir.items()}
    retencion.aplica(final, anterior, sin_servir=sin_servir)
    # Decisión 60: el `07130` del EMT del emisor comprueba el coste de operación ex ante del proveedor.
    # Solo avisa en el log, y solo si el fichero del emisor ya está cargado en este proceso.
    from fetchers import emt
    emt.comprueba_coste_operacion(final, isin)
    _postprocesa(final, ctx, isin)
    _marca_disponibilidad(final, isin, tipo, ctx, contestaciones, aportado, anterior,
                          sucesores=sucesores)
    return Resultado(datos=final, parciales=parciales, errores=errores,
                     detalle=detalle, plan=plan)


def _marca_disponibilidad(final: dict, isin: str, tipo: str, ctx: Contexto,
                          contestaciones: dict[str, bool | None],
                          aportado: dict[str, dict], anterior: dict | None,
                          sucesores: dict[str, str] | None = None) -> None:
    """Escribe `meta.disponibilidad`: por qué el instrumento trae o no trae datos.

    Decisión 14 de Óscar (02-11-2026): un instrumento que deja de cotizar se marca, no
    desaparece. Esto es el primer eslabón de esa cadena; de aquí la marca viaja al
    canónico y al contrato de la base.

    Va al final de la pasada a propósito, después de la retención y del saneado: así
    ningún paso posterior puede pisarla, y se decide con la ficha ya terminada.

    **Lo que NO hace, y conviene leerlo antes de confiar en el campo.** No le pone marca a
    un fondo. La única fuente que puede contestar «no lo tengo» es el buscador de símbolos
    de EODHD, por el que un fondo no pasa, así que `desde_la_pasada` devuelve `None` y el
    campo se queda **ausente** en vez de afirmar algo que no se ha medido. Que un fondo se
    liquide es un hecho real y sigue sin cubrir: hace falta una fuente que lo pruebe.

    Y queda otro hueco, este por construcción: una acción que SALGA del alcance algún día
    no se vuelve a pedir, así que su ficha no se reescribe y no recibe la marca. Hoy no le
    toca a ninguna -las 6 de fuera no tienen ficha-, pero el día que Óscar retire un país
    con acciones ya cargadas habrá que marcarlas sin pedirlas, que es barato porque la
    marca de alcance es una decisión y no un dato.

    **Un ISIN sustituido por otro no cotiza, aunque su precio llegue** (07-11-2026, decisión 1
    de `DECISIONES_DATOS_2026-11-07.md`). Si la fuente del precio avisa de que el listado que
    se le conocía es hoy de otro ISIN (`procedencia.sustituido_por`, que solo se da cuando
    EODHD y FIRDS coinciden), el estado es `DEJO_DE_COTIZAR` y el motivo nombra al sucesor.
    Desde el **día de la primera negociación del sucesor** según FIRDS, no desde el día en que
    se ve (decisión 15, `esma_firds.primera_negociacion`); sin esa fecha, el de la observación,
    y el motivo lo dice.
    Es la misma afirmación del estado —el proveedor ya no resuelve **este** ISIN, que antes
    sí— con la prueba de por qué: su búsqueda por el ISIN contesta vacío, y el símbolo que
    llega es el de una corrección escrita antes del cambio. El precio se queda en la ficha.

    **Una baja decidida gana a todo lo anterior** (07-11-2026, decisión 7 de
    `DECISIONES_DATOS_2026-11-07.md`; ver `core/bajas_decididas.py`). La evidencia se sigue
    calculando, porque si la fuente lo da hoy como que cotiza eso es un conflicto y se escribe
    en la marca en vez de perderse.
    """
    previo = ((anterior or {}).get("meta") or {}).get("disponibilidad") or {}
    evidencia = _marca_por_evidencia(isin, tipo, ctx, contestaciones, aportado, anterior,
                                     previo, sucesores)
    try:
        decidida = bajas_decididas.de(isin, ctx.base)
    except bajas_decididas.ErrorBaja as e:
        # Un fichero mal escrito no tumba la pasada, pero tampoco se calla: sin él, la baja
        # decidida no se aplica y la ficha vuelve a lo que diga la fuente.
        log.error("%s: %s", isin, e)
        final.setdefault("meta", {}).setdefault("errores", []).append(f"bajas_decididas: {e}")
        decidida = None
    if decidida:
        marca = bajas_decididas.marca(decidida, evidencia=evidencia,
                                      fuente=disponibilidad.FUENTE_QUE_PRUEBA_COTIZACION)
        if "conflicto" in marca:
            log.warning("%s: baja decidida (%s), pero %s lo da hoy como que cotiza; gana la "
                        "decisión y el conflicto queda en la marca", isin, decidida["autor"],
                        disponibilidad.FUENTE_QUE_PRUEBA_COTIZACION)
        final.setdefault("meta", {})["disponibilidad"] = marca
        return
    if evidencia is not None:
        final.setdefault("meta", {})["disponibilidad"] = evidencia


def _marca_por_evidencia(isin: str, tipo: str, ctx: Contexto,
                         contestaciones: dict[str, bool | None],
                         aportado: dict[str, dict], anterior: dict | None, previo: dict,
                         sucesores: dict[str, str] | None) -> dict | None:
    """La marca que sale de lo que contestan las fuentes, o `None` si no afirman nada."""
    fuente = disponibilidad.FUENTE_QUE_PRUEBA_COTIZACION
    alc = alcance_mercados.carga(ctx.base)
    en_alcance = alc.estado(isin, tipo) == alcance_mercados.DENTRO
    sucesor = (sucesores or {}).get(fuente)
    if en_alcance and sucesor:
        detalle = (f"ISIN sustituido por {sucesor}: el listado que se le conocía es hoy de ese "
                   "ISIN según EODHD, y FIRDS conoce ese y no este")
        from fetchers import esma_firds
        inicio = esma_firds.primera_negociacion(ctx.base, sucesor)
        if inicio:
            fecha, mics = inicio
            centros = " y ".join([", ".join(mics[:-1]), mics[-1]]) if len(mics) > 1 else mics[0]
            detalle += (f". Deja de cotizar el {fecha}, primera negociación de {sucesor} en "
                        f"{centros} según FIRDS")
        else:
            detalle += (f". FIRDS no trae la primera negociación de {sucesor} en un centro con "
                        "admisión, así que la fecha es la de la observación, no la del hecho")
        return disponibilidad.marca(
            disponibilidad.DEJO_DE_COTIZAR, anterior=previo, detalle=detalle,
            desde=inicio[0] if inicio else None)
    contesto = contestaciones.get(fuente)
    resuelve_ahora = bool(aportado.get(fuente)) or _etf_con_precio_de_otra_fuente(tipo, aportado)
    resolvia_antes = _resolvia_antes(isin, ctx, anterior, previo)
    estado = disponibilidad.desde_la_pasada(
        en_alcance=en_alcance, contesto=contesto,
        resuelve_ahora=resuelve_ahora, resolvia_antes=resolvia_antes,
    )
    if estado is None:
        if en_alcance and contesto and not resuelve_ahora:
            # El caso en que callarse es lo correcto, pero no en silencio: el proveedor
            # dice que no lo tiene y aquí no hay con qué saber si antes lo tuvo.
            log.warning("%s: el proveedor no lo resuelve y no hay prueba local de que lo "
                        "resolviera antes; se queda sin marca en vez de elegir entre "
                        "'dejo_de_cotizar' y 'nunca_resuelto'", isin)
        return None
    detalle = alc.motivo(isin, tipo) if not en_alcance else ""
    return disponibilidad.marca(estado, detalle=detalle, anterior=previo)


#: Hasta cuántos días puede tener el precio de otra fuente para probar que un ETF sigue vivo.
#: Dos semanas de festivos no paran un mercado: un precio más viejo no prueba nada, ni en un sentido ni en otro.
DIAS_DE_PRECIO_QUE_PRUEBAN_COTIZACION = 14


def _etf_con_precio_de_otra_fuente(tipo: str, aportado: dict[str, dict],
                                   hoy: dt.date | None = None) -> bool:
    """Un ETF del que justETF da hoy un precio reciente cotiza, lo tenga o no EODHD.

    El buscador de EODHD no encuentra todas las cotizaciones. Medido el 05-11-2026: a iShares Energy
    Storage (`IE000DR59CI3`) no lo encuentra por ISIN, aunque cotiza allí como `STOR.AS`, y salía
    «dejó de cotizar» porque su ficha anterior tenía precio —de justETF, a 8,73 € del 02-11—, con
    52,7 M€ de patrimonio. A ese ya lo resuelve su corrección de símbolo; esto queda para los demás.

    No contradice lo que dice `disponibilidad` de la frescura: un precio viejo no prueba una
    defunción, y por eso aquí solo cuenta en un sentido. Y solo para un ETF: es el único tipo
    que tiene una segunda fuente que publica su cotización.
    """
    if str(tipo or "").strip().lower() != "etf":
        return False
    valoracion = (aportado.get("justetf") or {}).get("valoracion") or {}
    if valoracion.get("vl") is None or not valoracion.get("vl_fecha"):
        return False
    try:
        fecha = dt.date.fromisoformat(str(valoracion["vl_fecha"])[:10])
    except ValueError:
        return False
    return ((hoy or dt.date.today()) - fecha).days <= DIAS_DE_PRECIO_QUE_PRUEBAN_COTIZACION


def _resolvia_antes(isin: str, ctx: Contexto, anterior: dict | None,
                    previo: dict) -> bool | None:
    """¿Resolvía este instrumento antes de esta pasada? `None` es «no se sabe».

    Tres pruebas, de la más directa a la más indirecta, y ninguna inventada:

    1. La marca de la pasada anterior, **pero solo si dice algo del asunto**. `COTIZA` y
       `DEJO_DE_COTIZAR` prueban que resolvía; `NUNCA_RESUELTO` prueba que no. Los otros
       dos no afirman nada sobre la cotización —`SIN_DETERMINAR` es un intento fallido y
       `FUERA_DE_ALCANCE` una decisión nuestra—, así que se sigue buscando. Tratarlos como
       un «no» tenía un efecto feo y nada teórico: una tarde sin red dejaba la marca en
       `SIN_DETERMINAR`, y a la pasada siguiente el instrumento pasaba a `NUNCA_RESUELTO`
       como si no hubiera cotizado nunca, borrando con una la historia de la otra.
    2. La ficha anterior con valor liquidativo: para la primera pasada con marca es la
       prueba de que resolvía, y sin ella las 301 acciones ya cargadas parecerían no haber
       resuelto nunca.
    3. El histórico en disco con alguna observación: cubre al instrumento que perdió la
       ficha pero dejó serie. De las cinco españolas que dejaron de cotizar, a una
       (ES0161560018) la salva justo esta prueba.

    Si ninguna vale, `None`, y quien decide qué hacer con eso es `desde_la_pasada`.
    """
    antes = str(previo.get("estado") or "")
    if antes in (disponibilidad.COTIZA, disponibilidad.DEJO_DE_COTIZAR):
        return True
    if antes == disponibilidad.NUNCA_RESUELTO:
        return False
    if ((anterior or {}).get("valoracion") or {}).get("vl") is not None:
        return True
    historia = ctx.base / "data" / "history" / f"{isin}.jsonl"
    try:
        if historia.exists() and historia.stat().st_size > 0:
            return True
    except OSError:
        pass
    return None


def aplica_contraste(parciales: list[tuple[str, dict]],
                     procedencias: dict[str, dict[str, str]]) -> dict[str, dict]:
    """Saca de la fusión lo que una fuente desplazada trae en las rutas de otra
    que manda (`registro.CONTRASTE`) y lo devuelve para `meta.contraste`.

    Solo si la que manda sirvió dato para el activo (`si_trae`); si no, la
    desplazada sigue de respaldo. Modifica los parciales y sus procedencias in
    situ. Fase 0 del plan sin Morningstar (28-10-2026): el VL y, en las clases
    de acumulación, las métricas de la serie de EODHD mandan; los de
    Morningstar quedan para comparar."""
    from core.adquisicion import capacidades
    from core.schema import _get_path, _quita

    por_fuente = dict(parciales)
    salida: dict[str, dict] = {}
    for regla in registro.CONTRASTE:
        manda = regla["manda"]
        datos_manda = por_fuente.get(manda)
        if not datos_manda or _get_path(datos_manda, regla["si_trae"]) in (None, "", [], {}):
            continue
        patrones = dict.fromkeys(regla["rutas"], "")
        for fuente in regla["desplaza"]:
            datos = por_fuente.get(fuente)
            if not datos:
                continue
            etiquetas = procedencias.get(fuente) or {}
            for ruta, valor in list(procedencia.hojas(datos)):
                if not capacidades.cubre(patrones, ruta):
                    continue
                salida[ruta] = {"fuente": etiquetas.get(ruta) or fuente, "valor": valor,
                                "desplazada_por": manda, "bloque": regla["bloque"]}
                _quita(datos, ruta.split("."))
                etiquetas.pop(ruta, None)
    return dict(sorted(salida.items()))


def _postprocesa(final: dict, ctx: Contexto, isin: str = "") -> None:
    """Saneado de siempre, atribuyendo lo que cada paso crea o renombra.

    Antes del saneado entran las correcciones manuales (`core.correcciones`):
    así lo derivado y la calidad se calculan ya con el dato corregido."""
    proc: dict[str, str] = final["meta"].get("procedencia") or {}
    if isin:
        aplicadas = correcciones.aplica(final, isin, ctx.base, proc)
        if aplicadas:
            final["meta"]["correcciones"] = aplicadas
    for nombre, paso in PASOS_DERIVADOS:
        paso(final)
        # La limpieza renombra claves (país -> ISO3, sector -> canónico): la
        # ruta nueva hereda la fuente de sus hermanas. Los demás pasos crean
        # campos nuevos, que son suyos.
        _atribuye_nuevas(final, proc, f"{procedencia.DERIVADO}:{nombre}",
                         heredar=(nombre == "limpieza"))
    alinea_fechas_por_ventana(final, proc)
    figi.aplica(final, base=ctx.base)
    _atribuye_nuevas(final, proc, f"{procedencia.DERIVADO}:figi")
    calidad.aplica(final)
    _atribuye_nuevas(final, proc, f"{procedencia.DERIVADO}:calidad")
    final["meta"]["procedencia"] = dict(sorted(proc.items()))


def alinea_fechas_por_ventana(final: dict, proc: dict[str, str]) -> None:
    """Quita la fecha de una ventana que no es la de la cifra publicada (decisión B-74).

    Cada fetcher escribe la fecha junto a su cifra, pero la fusión elige ruta a
    ruta: si la cifra la gana una fuente que no trae fecha (la serie propia,
    EODHD en un ETF, una corrección manual) o la limpieza la quita, la fecha que
    quedase sería la de otra cifra. Se conserva solo si la cifra existe y las dos
    tienen la misma procedencia, que es lo que dice que salen de la misma respuesta.
    """
    rent = final.get("rentabilidad")
    fechas = rent.get("fecha_dato_por_ventana") if isinstance(rent, dict) else None
    if not isinstance(fechas, dict):
        return
    trailing = rent.get("trailing_pct") if isinstance(rent.get("trailing_pct"), dict) else {}
    for ventana in list(fechas):
        ruta_fecha = f"rentabilidad.fecha_dato_por_ventana.{ventana}"
        ruta_cifra = f"rentabilidad.trailing_pct.{ventana}.fondo"
        cifra = (trailing.get(ventana) or {}).get("fondo")             if isinstance(trailing.get(ventana), dict) else None
        if cifra is None or proc.get(ruta_cifra) != proc.get(ruta_fecha):
            del fechas[ventana]
            proc.pop(ruta_fecha, None)
    if not fechas:
        del rent["fecha_dato_por_ventana"]


def _atribuye_nuevas(final: dict, proc: dict[str, str], etiqueta: str,
                     heredar: bool = False) -> None:
    vivas = {ruta for ruta, _v in procedencia.hojas(final)
             if not ruta.startswith("meta.")}
    # Primero se resuelven las nuevas (con `heredar`, una clave renombrada toma
    # la fuente de sus hermanas, que todavía están en `proc`); después se
    # olvidan las muertas.
    nuevas = {ruta: (_por_hermanos(proc, ruta) if heredar else None) or etiqueta
              for ruta in vivas if ruta not in proc}
    for ruta in list(proc):
        if ruta not in vivas and not ruta.startswith("meta."):
            del proc[ruta]
    proc.update(nuevas)


def _por_hermanos(proc: dict[str, str], ruta: str) -> str | None:
    """Una clave renombrada (país -> ISO3) hereda la fuente de sus hermanas."""
    padre = ruta.rsplit(".", 1)[0] if "." in ruta else None
    if not padre:
        return None
    votos: dict[str, int] = {}
    for r, etiqueta in proc.items():
        if r.startswith(padre + ".") and r.count(".") == ruta.count("."):
            votos[etiqueta] = votos.get(etiqueta, 0) + 1
    if not votos:
        return None
    return max(votos.items(), key=lambda x: x[1])[0]
