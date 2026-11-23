# -*- coding: utf-8 -*-
"""
Lector de la base nueva con la interfaz que espera `repository.py` (la del lector antiguo, `FirestoreReader`,
borrado el 21-11-2026 con el resto del codigo de la base vieja).

`repository.py` recibe un lector duck-typed y `mappers.py` traduce la forma vieja al
contrato asset-for-bdb.v1. Aqui se reconstruye esa forma desde la base nueva, asi que las
callables de lectura no cambian y una sola capa conoce los dos modelos.

Las cifras salen de `read/card`, que es lo que ya leen el buscador y la ficha. Si salieran
de otro documento, dos pantallas podrian ensenar dos numeros para el mismo activo.

El Sharpe y el Sortino de una accion individual no se proyectan (par. 9 del metodo).
"""
import bisect
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

from google.api_core.retry import Retry

from ecb_rates import _weighted_average_percent, resolve_estr_window_average
from master_project import PROYECTO_BASE_NUEVA, exigir_base_nueva
from .firestore_client import _valid_asset_id, get_master_db

ESQUEMA_SERIE_VIEJO = "asset-price-series.v1.2"
TOLERANCIA_CAMBIO_DIAS = 7
MONEDAS_MENORES = {"GBX": ("GBP", 0.01), "GBp": ("GBP", 0.01)}
_TTL_CAMBIOS_SEGUNDOS = 15 * 60
_CAMBIOS: dict = {}
_CERROJO_CAMBIOS = threading.Lock()
_VENTANAS = ("1y", "3y", "5y", "10y")
# Lo que la tarjeta dice de sus metricas sin ser una cifra, y que viaja con ellas (hallazgo 16): la fecha de corte, la de las
# rentabilidades (tambien por ventana), la base de rentabilidad, sobre que precio se midio, la politica de reparto y las cifras
# apartadas por salirse de rango.
CONTEXTO_DE_LAS_METRICAS = ("as_of", "returns_as_of", "returns_as_of_by_window", "return_basis", "series_class",
                            "distribution_policy", "windows_out_of_range")
_LOTE_GET_ALL = 300
# El limite de cada lectura, el mismo que tenia el lector antiguo (`optimization/firestore_reader.py`). Sin el,
# una base que no contesta deja la llamada colgada hasta que la corta la propia funcion, y Simular lee
# con seis hilos contando con el (hallazgo 19 de la auditoria del 15-11-2026).
PLAZO_LECTURA_SEGUNDOS = 15


def _plazo(segundos=PLAZO_LECTURA_SEGUNDOS) -> dict:
    """Lo que se pasa a cada `stream()`, `get()` y `get_all()`: el plazo y un reintento que no lo rebasa."""
    return {"timeout": segundos, "retry": Retry(deadline=segundos)}


# La region de una accion, por la bolsa en la que cotiza. Son las 11 de la tarjeta, medidas el
# 05-11-2026: dan el mismo pais que `declared/equity.listing.country` en las 293 acciones que lo traen
# y cubren ademas las 7 de Suiza y Toronto, que no lo traen, sin pedir un documento mas por accion. Es
# donde cotiza y no donde trabaja. Una bolsa que no este aqui deja la accion sin region, que es lo que
# se sabe de ella.
REGION_POR_BOLSA = {
    "MC": "Eurozona", "MCE": "Eurozona", "PA": "Eurozona", "XETRA": "Eurozona", "F": "Eurozona",
    "AS": "Eurozona", "HE": "Eurozona",
    "LSE": "Reino Unido", "SW": "Europa ex-euro", "US": "EE.UU.", "TO": "Canadá",
}


# Los `OTHER` que se han mirado uno a uno y se miden como un producto cotizado, con su serie (decision 76). El contrato no tiene
# el tipo ETC, y por eso la base lo guarda sin `product_type`: `traducciones.ts` manda `etc` a OTHER a proposito, y llamarlo ETF
# en los datos seria falso. Aqui se marca lo que ya trae la base vieja, y el servidor lo trata como trata alli a este mismo
# instrumento. Es una lista y no una regla sobre OTHER: otro que llegue no entra solo. Se queda fuera del calculo, y lo dice,
# hasta que alguien mire que es y de que precio es su serie.
ETC_REVISADOS = frozenset({
    "IE00B4ND3602",  # iShares Physical Gold ETC. Medido el 05-11-2026: el unico OTHER de 1.104, y su serie en euros cuadra con la de la base vieja.
})


def es_etc_revisado(instrument_id, tipo) -> bool:
    return tipo == "OTHER" and instrument_id in ETC_REVISADOS


def _a_pct(valor) -> Optional[float]:
    return round(valor * 100, 8) if isinstance(valor, (int, float)) else None


def _en_moneda_mayor(importe, moneda):
    """Un importe en peniques pasa a libras; las demas monedas, tal cual. Sin moneda, None."""
    if not isinstance(importe, (int, float)) or isinstance(importe, bool) or not isinstance(moneda, str) or not moneda.strip():
        return None
    mayor, factor = MONEDAS_MENORES.get(moneda.strip(), (moneda.strip().upper(), 1.0))
    return importe * factor, mayor


def rentabilidad_por_dividendo_prevista(tarjeta: Optional[dict]) -> Optional[float]:
    """
    El dividendo previsto por accion para los proximos 12 meses entre el precio de hoy, en tanto por uno (decision A-143, Oscar,
    12-11-2026). Es una estimacion, y el informe lo rotula asi.

    Oscar eligio primero lo pagado en 12 meses, pero `trailing_amount_per_share` no es fiable (medido el 12-11-2026 sobre las 526
    acciones de la base nueva): 45 dicen 0 aunque reparten, y en suizas viene en dolares aunque diga francos (Novartis 4,666 por
    3,70 CHF). Lo previsto (`forward_amount_per_share`) cuadra donde se ha comprobado. Hasta tener la historia de pagos propia, esto.

    Se calcula con nuestro precio, no se copia `yield_12m`: asi la cifra se reproduce con dos datos de la tarjeta. Solo si el importe
    y el precio estan en la misma moneda (los peniques cuentan como libras) y el precio es positivo. Cero solo si las tres senales
    del proveedor dicen que no reparte (previsto, pagado y su rentabilidad, a cero o sin previsto); si no, None y el informe dice
    que falta: un cero que parece verdad es peor que un hueco.
    """
    tarjeta = tarjeta or {}
    dividendos = tarjeta.get("dividends") or {}
    cotizacion = tarjeta.get("quote") or {}
    precio = _en_moneda_mayor(cotizacion.get("price"), cotizacion.get("currency"))
    if precio is None or precio[0] <= 0:
        return None
    bruto = dividendos.get("forward_amount_per_share")
    if isinstance(bruto, (int, float)) and not isinstance(bruto, bool) and bruto > 0:
        previsto = _en_moneda_mayor(bruto, dividendos.get("currency"))
        if previsto is None or previsto[1] != precio[1]:
            return None
        return round(previsto[0] / precio[0], 6)
    if (bruto is None or bruto == 0) and dividendos.get("trailing_amount_per_share") == 0 and dividendos.get("yield_12m") == 0:
        return 0.0
    return None


def raiz_vieja(instrument_id: str, raiz: dict, tarjeta: Optional[dict] = None,
               exposicion: Optional[dict] = None) -> dict:
    """Documento raiz con la forma que espera mappers.py."""
    tarjeta = tarjeta or {}
    exposicion = exposicion or {}
    identidad = raiz.get("identity") or {}
    clase = raiz.get("classification") or {}
    clase_de_la_tarjeta = tarjeta.get("classification") or {}
    costes = tarjeta.get("costs") or {}
    renta_fija = tarjeta.get("fixed_income") or {}
    cotizacion = tarjeta.get("quote") or {}
    referencia = clase.get("official_benchmark") or {}
    identificadores = dict(raiz.get("identifiers") or {})
    if len(instrument_id) == 12:
        identificadores.setdefault("isin", instrument_id)

    mezcla = exposicion.get("asset_mix")
    if isinstance(mezcla, dict):
        mezcla = {"bond" if clave == "fixed_income" else clave: valor for clave, valor in mezcla.items()}
    es_etc = es_etc_revisado(instrument_id, raiz.get("instrument_type"))

    documento = {
        "asset_id": instrument_id,
        "asset_type": raiz.get("instrument_type"),
        "updated_at": raiz.get("updated_at"),
        "identity": {"name": identidad.get("name"), "currency": identidad.get("currency")},
        "identifiers": identificadores,
        "classification": {
            "category": clase.get("category"),
            "morningstar_rating": clase.get("morningstar_rating"),
            "asset_class": clase.get("asset_class"),
            "official_benchmark": referencia.get("name") if isinstance(referencia, dict) else referencia,
            "sector": clase_de_la_tarjeta.get("sector"),
            "region_primary": (REGION_POR_BOLSA.get(clase_de_la_tarjeta.get("exchange"))
                               if raiz.get("instrument_type") == "STOCK" else None),
        },
        "product": {**(raiz.get("product") or {}), "product_type": "ETC"} if es_etc else raiz.get("product") or {},
        "costs": {
            "ter_pct": _a_pct(costes.get("ongoing_charge")),
            # Un ETC no es un fondo: lo que cobra es su coste corriente. El proveedor da 0,00 % «aplicada», 0,12 % de maximo y 0,12 %
            # de coste corriente, y un 0 % de gestion se leeria como que no cobra.
            "management_fee_pct": None if es_etc else _a_pct(costes.get("management_fee")),
            "transaction_costs_pct": _a_pct(costes.get("transaction_costs")),
            "entry_fee_max_pct": _a_pct(costes.get("entry_charge")),
            # Aqui ya viene decidido de donde sale cada cifra, y por eso `map_costs` no vuelve a elegir.
            "document_url": costes.get("document_url"),
            "document_date": costes.get("document_date"),
            "ongoing_charge_source": costes.get("ongoing_charge_source"),
            "transaction_costs_source": costes.get("transaction_costs_source"),
            "entry_charge_source": costes.get("entry_charge_source"),
        },
        "portfolio_exposure": {
            "asset_mix": mezcla,
            "sectors": exposicion.get("sectors"),
            "equity_regions": exposicion.get("equity_regions"),
            "equity_styles": exposicion.get("equity_styles"),
            "market_caps": exposicion.get("market_caps"),
            "equity_style_box": exposicion.get("equity_style_box"),
            "bond_types": exposicion.get("bond_types"),
            "exposure_confidence": exposicion.get("confidence"),
        },
        "fixed_income_profile": {
            "effective_duration": renta_fija.get("effective_duration"),
            "modified_duration": renta_fija.get("modified_duration"),
            "effective_maturity": renta_fija.get("effective_maturity"),
            "yield_to_maturity": _a_pct(renta_fija.get("yield_to_maturity")),
            "investment_grade_pct": _a_pct(renta_fija.get("investment_grade")),
            "high_yield_pct": _a_pct(renta_fija.get("high_yield")),
            "avg_credit_quality": renta_fija.get("avg_credit_quality"),
        },
        "latest": {
            "value": cotizacion.get("price"),
            "date": cotizacion.get("as_of"),
            "source": (tarjeta.get("metrics") or {}).get("source"),
            # La divisa de ESTE precio, que no es la de la clase: en 15 de los 32 ETF la clase esta en dolares y el precio en euros
            # (medido el 15-11-2026, hallazgo 17). Sin ella, quien pinta el precio con la divisa de la clase escribe «98,4 USD».
            "currency": cotizacion.get("currency"),
        },
    }
    # La rentabilidad por dividendo de una accion, la que lee el informe de cliente (`fundamentals_summary.dividends.yield_ratio`).
    # Solo esa cifra: la base nueva no tiene los demas fundamentales del emisor, y no se rellenan.
    if raiz.get("instrument_type") == "STOCK":
        rentabilidad = rentabilidad_por_dividendo_prevista(tarjeta)
        if rentabilidad is not None:
            documento["fundamentals"] = {
                "source": "base-nueva",
                "as_of_date": cotizacion.get("as_of"),
                "dividends": {"yield_ratio": rentabilidad},
            }
    estado = (raiz.get("availability") or {}).get("state")
    if estado == "DELISTED":
        documento["is_investable"] = False
    # Decision 44: lo que nunca se resolvio no se elige, y lo decide quien lee este estado (`asset_eligibility.nunca_resuelto`).
    if estado == "NEVER_RESOLVED":
        documento["availability"] = {"state": estado}
    return documento


def metricas_viejas(tarjeta: Optional[dict]) -> Optional[dict]:
    """`metrics/latest` con la forma vieja, desde la tarjeta. Sin metricas, None."""
    metricas = (tarjeta or {}).get("metrics")
    if not isinstance(metricas, dict) or not metricas.get("method"):
        return None
    es_accion = tarjeta.get("instrument_type") == "STOCK"
    rentabilidad = metricas.get("annualized_return") or {}
    volatilidad = metricas.get("volatility") or {}
    sharpe = {} if es_accion else (metricas.get("sharpe") or {})
    # Donde no hay ninguna cifra nuestra, la ventana del proveedor, con su metodo (decision 110). Entera o nada: en una ventana con
    # cifras nuestras no entra una suya, porque esta forma no tiene donde decir de quien es cada una. La tarjeta ya ha dejado fuera lo
    # que toca la fecha desde la que vale la serie (decision 112).
    suyas = metricas.get("provider") or {}
    ventanas = {}
    alguna_suya = False
    for ventana in _VENTANAS:
        nodo = {
            "annualized_return": rentabilidad.get(ventana),
            "annualized_volatility": volatilidad.get(ventana),
            "sharpe_ratio": sharpe.get(ventana),
        }
        if any(valor is not None for valor in nodo.values()):
            ventanas[ventana] = {**nodo, "method": metricas.get("method"), "frequency": metricas.get("frequency")}
            continue
        suya = {
            "annualized_return": (suyas.get("annualized_return") or {}).get(ventana),
            "annualized_volatility": (suyas.get("volatility") or {}).get(ventana),
            "sharpe_ratio": None if es_accion else (suyas.get("sharpe") or {}).get(ventana),
        }
        if any(valor is not None for valor in suya.values()):
            ventanas[ventana] = {**suya, "method": suyas.get("method"), "frequency": "PROVIDER"}
            alguna_suya = True
    salida = {
        "source": metricas.get("source"),
        "windows": ventanas,
        "ytd_return": metricas.get("ytd_return"),
        "max_drawdown_5y": (metricas.get("max_drawdown") or {}).get("5y"),
        "srri": metricas.get("risk_score"),
        "risk_score_source": metricas.get("risk_score_source"),
        "last_date": metricas.get("as_of"),
    }
    # Hallazgo 16 (15-11-2026): con las cifras, lo que hace falta para leerlas. De cuando son y que miden, con los nombres de la
    # tarjeta y tal como vienen: lo que la tarjeta no trae no se deduce aqui, y la regla de que fecha vale para cada ventana es suya.
    contexto = {clave: metricas.get(clave) for clave in CONTEXTO_DE_LAS_METRICAS if metricas.get(clave) is not None}
    if alguna_suya:
        # Las ventanas del proveedor van a la fecha de su bloque, no a la del titular (decision 110).
        fechas_suyas = {clave: suyas.get(clave) for clave in ("as_of", "returns_as_of", "returns_as_of_by_window") if suyas.get(clave) is not None}
        if fechas_suyas:
            contexto["provider"] = fechas_suyas
    if contexto:
        salida["context"] = contexto
    return salida


def resumen_de_posiciones(resumen: Optional[dict]) -> Optional[dict]:
    """Resumen de posiciones de la tarjeta, con top10 en porcentaje como la forma vieja."""
    if not resumen:
        return None
    return {"data": {
        "holdings_count": resumen.get("positions_count"),
        "top10_weight": _a_pct(resumen.get("top10_weight")),
        "as_of_date": resumen.get("as_of"),
    }}


LISTA_COMPLETA = "FULL"
LISTA_DE_LAS_PRINCIPALES = "TOP"


def _alcance_de_las_posiciones(cabecera: dict, lista_completa: bool) -> dict:
    """Lo que hace falta para no leer una lista parcial como completa (hallazgo 20, 15-11-2026). Todo aditivo.

    - `securities_count`: los titulos de la cartera segun el proveedor, acciones mas bonos. Es el total que se ensena: `holdings_count`
      (`positions_count` en la base) es el numero de bonos o, si no hay, el de acciones, y se deja como esta porque lo leen otros.
    - `coverage`: la parte del patrimonio que cubren las posiciones que da la fuente, en tanto por uno, como en el contrato.
    - `list_scope`: `FULL` si se sirve la cartera entera (sus trozos) y `TOP` si solo las principales de la cabecera, que son 25.
    Lo que la cabecera no trae no sale: no se deduce.
    """
    alcance = {"list_scope": LISTA_COMPLETA if lista_completa else LISTA_DE_LAS_PRINCIPALES}
    for clave in ("securities_count", "coverage"):
        if isinstance(cabecera.get(clave), (int, float)) and not isinstance(cabecera.get(clave), bool):
            alcance[clave] = cabecera[clave]
    return alcance


def posicion_vieja(posicion: dict) -> dict:
    fila = {
        "holding_name": posicion.get("name"),
        "holding_weight": _a_pct(posicion.get("weight")),
        "holding_weight_unit": "percent",
    }
    for origen, destino in (("isin", "isin"), ("ticker", "ticker"), ("asset_type", "instrument_type"),
                            ("holding_type_code", "holding_type_code"),
                            ("currency", "currency"), ("country", "country"), ("sector", "sector")):
        if posicion.get(origen) is not None:
            fila[destino] = posicion[origen]
    return fila


class LectorBaseNueva:
    read_timeout_seconds = PLAZO_LECTURA_SEGUNDOS

    max_parallel_reads = 6

    def __init__(self, db=None):
        self.db = db or get_master_db()
        # Una peticion crea su lector (`lector_de_activos()`), asi que esta memoria vive lo que la peticion y no se comparte
        # entre peticiones: no hay TTL que justificar ni dato viejo que servir. P1-12 (auditoria del 20-11-2026): `resolve_portfolio`
        # leia `read/card` tres veces (raices, metricas, resumenes de posiciones).
        self._memoria = {}            # (ruta, id) -> datos, o None si el documento no existe
        self._posiciones = {}         # id -> (cabecera, posiciones), o None si no tiene `declared/holdings`
        self._cerrojo_memoria = threading.Lock()
        self.documentos_leidos = 0    # documentos pedidos a la base, para medirlo en las pruebas

    def _instrumento(self, instrument_id: str):
        return self.db.collection("instruments").document(str(instrument_id))

    def _leer_muchos(self, referencias: list) -> list:
        snaps = []
        for inicio in range(0, len(referencias), _LOTE_GET_ALL):
            snaps.extend(self.db.get_all(referencias[inicio:inicio + _LOTE_GET_ALL], **_plazo(self.read_timeout_seconds)))
        with self._cerrojo_memoria:
            self.documentos_leidos += len(referencias)
        return snaps

    def _datos_por_instrumento(self, asset_ids, *ruta) -> dict:
        """{id: datos} de un documento bajo cada instrumento. Sin `ruta`, la raiz.

        Un identificador fuera del alfabeto del catalogo no se lee: con barras construiria la ruta de otro
        documento (`X/read/card`), y con un numero impar de tramos haria fallar la lectura (hallazgo 21).
        Es la misma puerta que el lector antiguo, y se trata como un activo que no existe.

        Lo ya leido por este lector no se vuelve a pedir, ni lo que no existia. Los dicts que salen se comparten con la memoria:
        quien los reciba no los modifica.
        """
        ids = [a for a in dict.fromkeys(a for a in asset_ids if _valid_asset_id(a))]
        with self._cerrojo_memoria:
            faltan = [a for a in ids if (ruta, a) not in self._memoria]
        if faltan:
            referencias = []
            for asset_id in faltan:
                referencia = self._instrumento(asset_id)
                if ruta:
                    referencia = referencia.collection(ruta[0]).document(ruta[1])
                referencias.append(referencia)
            leidos = {}
            for snap in self._leer_muchos(referencias):
                if snap.exists:
                    leidos[snap.id if not ruta else snap.reference.parent.parent.id] = snap.to_dict() or {}
            with self._cerrojo_memoria:
                for asset_id in faltan:
                    self._memoria[(ruta, asset_id)] = leidos.get(asset_id)
        with self._cerrojo_memoria:
            return {a: self._memoria[(ruta, a)] for a in ids if self._memoria.get((ruta, a)) is not None}

    def get_assets_many(self, asset_ids) -> dict:
        ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if _valid_asset_id(asset_id)))
        raices = self._datos_por_instrumento(ids)
        tarjetas = self._datos_por_instrumento(list(raices), "read", "card")
        exposiciones = self._datos_por_instrumento(list(raices), "declared", "exposure")
        return {
            asset_id: raiz_vieja(asset_id, raiz, tarjetas.get(asset_id), exposiciones.get(asset_id))
            for asset_id, raiz in raices.items()
        }

    def get_asset(self, asset_id: str) -> Optional[dict]:
        return self.get_assets_many([asset_id]).get(asset_id) if _valid_asset_id(asset_id) else None

    def get_metrics_latest_many(self, asset_ids) -> dict:
        tarjetas = self._datos_por_instrumento(list(dict.fromkeys(a for a in asset_ids if _valid_asset_id(a))), "read", "card")
        salida = {}
        for asset_id, tarjeta in tarjetas.items():
            metricas = metricas_viejas(tarjeta)
            if metricas is not None:
                salida[asset_id] = metricas
        return salida

    def get_metrics_latest(self, asset_id: str) -> Optional[dict]:
        return self.get_metrics_latest_many([asset_id]).get(asset_id)

    def get_search_index(self) -> Optional[dict]:
        entradas = []
        for snap in self.db.collection("search_shards").stream(**_plazo(self.read_timeout_seconds)):
            for entrada in (snap.to_dict() or {}).get("entries") or []:
                entradas.append({
                    "id": entrada.get("instrument_id"),
                    "name": entrada.get("name"),
                    "name_folded": entrada.get("name_folded"),
                    # Lo mismo que `search_index.py` para la base vieja: con el tipo crudo, el filtro de tipos no lo devuelve nunca.
                    "type": "ETF" if es_etc_revisado(entrada.get("instrument_id"), entrada.get("instrument_type")) else entrada.get("instrument_type"),
                    "ticker": entrada.get("ticker"),
                    "class": entrada.get("asset_class"),
                    "currency": entrada.get("currency"),
                })
        if not entradas:
            return None
        entradas.sort(key=lambda entrada: str(entrada.get("id") or ""))
        return {"entries": entradas, "count": len(entradas)}

    def get_holdings_summaries_many(self, asset_ids) -> dict:
        tarjetas = self._datos_por_instrumento(list(dict.fromkeys(a for a in asset_ids if _valid_asset_id(a))), "read", "card")
        salida = {}
        for asset_id, tarjeta in tarjetas.items():
            resumen = resumen_de_posiciones(tarjeta.get("holdings_summary"))
            if resumen is not None:
                salida[asset_id] = resumen
        return salida

    def get_holdings_summary(self, asset_id: str) -> Optional[dict]:
        return self.get_holdings_summaries_many([asset_id]).get(asset_id)

    def _trozos_de(self, asset_id: str) -> list:
        trozos = sorted(self._instrumento(asset_id).collection("holdings_chunks").stream(**_plazo(self.read_timeout_seconds)),
                        key=lambda snap: snap.id)
        with self._cerrojo_memoria:
            self.documentos_leidos += len(trozos)
        return [p for snap in trozos for p in (snap.to_dict() or {}).get("positions") or []]

    def _posiciones_de(self, asset_ids) -> dict:
        """{id: (cabecera, posiciones)} de los que tienen `declared/holdings`.

        La cabecera de todos va en una sola lectura por lotes y los trozos de cada uno, en paralelo (P1-12: eran dos llamadas en
        serie por activo). Lo que se lee bien queda en memoria aunque otro falle: si una lectura falla, la excepcion sale cuando
        han acabado las demas, y quien reintente suelto (`get_asset_holdings_many`) no vuelve a pedir lo que ya esta.
        """
        ids = list(dict.fromkeys(a for a in asset_ids if _valid_asset_id(a)))
        cabeceras = self._datos_por_instrumento(ids, "declared", "holdings")
        pendientes = [a for a in ids if a in cabeceras and a not in self._posiciones]
        errores = []
        if len(pendientes) <= 1:
            for asset_id in pendientes:
                try:
                    self._posiciones[asset_id] = (cabeceras[asset_id], self._trozos_de(asset_id))
                except Exception as exc:
                    errores.append(exc)
        else:
            with ThreadPoolExecutor(max_workers=min(self.max_parallel_reads, len(pendientes))) as pool:
                futuros = {a: pool.submit(self._trozos_de, a) for a in pendientes}
            for asset_id in pendientes:
                try:
                    posiciones = futuros[asset_id].result()
                except Exception as exc:
                    errores.append(exc)
                    continue
                with self._cerrojo_memoria:
                    self._posiciones[asset_id] = (cabeceras[asset_id], posiciones)
        if errores:
            raise errores[0]
        return {a: self._posiciones[a] for a in ids if a in cabeceras}

    @staticmethod
    def _documento_de_posiciones(asset_id: str, cabecera: dict, posiciones: list) -> dict:
        from fund_data_quality import normalize_holdings

        filas = [posicion_vieja(p) for p in (posiciones or cabecera.get("top") or [])]
        return {"data": {
            "storage_mode": "SINGLE_DOCUMENT",
            "holdings_count": cabecera.get("positions_count"),
            "top10_weight": _a_pct(cabecera.get("top10_weight")),
            "as_of_date": cabecera.get("as_of"),
            "holdings": normalize_holdings(asset_id, filas),
            **_alcance_de_las_posiciones(cabecera, bool(posiciones)),
        }}

    def get_holdings(self, asset_id: str) -> Optional[dict]:
        if not _valid_asset_id(asset_id):
            return None
        hallado = self._posiciones_de([asset_id]).get(asset_id)
        return self._documento_de_posiciones(asset_id, *hallado) if hallado else None

    def get_holdings_many(self, asset_ids) -> dict:
        return {asset_id: self._documento_de_posiciones(asset_id, *hallado)
                for asset_id, hallado in self._posiciones_de(asset_ids).items()}

    def list_assets(self, types, limit: int) -> list:
        ids = []
        coleccion = self.db.collection("instruments")
        for tipo in types:
            consulta = coleccion.where("instrument_type", "==", tipo).limit(int(limit))
            ids.extend(snap.id for snap in consulta.stream(**_plazo(self.read_timeout_seconds)))
        return list(self.get_assets_many(ids).values())


def _cambio_valido(c) -> bool:
    """Un cambio sirve si es un numero finito y positivo; lo demas (0, negativo, NaN, texto) se aparta en vez de dividir por el."""
    return isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) and c > 0


def a_euros(documento: dict, cambios: list) -> Optional[dict]:
    """El anio de una serie llevado a euros con los cambios del BCE, o None si no queda nada.

    Decision 10: cada precio usa el ultimo cambio en o antes de su fecha, con 7 dias de
    tolerancia por los festivos de TARGET. Sin cambio, el punto se descarta en vez de
    inventarlo. Los peniques pasan a libras antes de convertir.
    """
    divisa = documento.get("currency")
    moneda, escala = MONEDAS_MENORES.get(divisa, (divisa, 1.0))
    # P3-04: un cambio que no es un numero positivo no sirve para dividir (cero daba ZeroDivisionError). Se aparta como si no
    # existiera: el punto usa el ultimo cambio bueno en tolerancia, o se descarta, y no se inventa uno.
    cambios = [(f, c) for f, c in cambios if _cambio_valido(c)]
    fechas = [fecha for fecha, _ in cambios]
    puntos = []
    for punto in documento.get("points") or []:
        i = bisect.bisect_right(fechas, punto["date"]) - 1
        if i < 0:
            continue
        fecha_cambio, cambio = cambios[i]
        if (date.fromisoformat(punto["date"]) - date.fromisoformat(fecha_cambio)).days > TOLERANCIA_CAMBIO_DIAS:
            continue
        puntos.append({
            "date": punto["date"],
            "value": punto["value"] * escala / cambio,
            "source_value": punto["value"],
            "fx_rate": cambio,
        })
    if not puntos:
        return None
    return {
        **documento,
        "currency": "EUR",
        "source_currency": divisa,
        "fx_pair": f"ECB:EXR/D.{moneda}.EUR.SP00.A",
        "minor_scale": escala,
        "first_date": puntos[0]["date"],
        "last_date": puntos[-1]["date"],
        "observations_count": len(puntos),
        "points": puntos,
    }


def retornos_viejos(declarados: dict) -> dict:
    """`declared/provider_returns` con la forma de `performance.returns`, la que lee `metrics_reconciliation`.

    Solo si el proveedor las da como rentabilidad total: contrastar la serie con otra cosa no diria nada de ella.
    """
    if declarados.get("return_basis") != "TOTAL_RETURN":
        return {}
    ventanas = declarados.get("trailing_return") or {}
    return {
        "fecha_dato": declarados.get("as_of"),
        "trailing_pct": {
            clave: {"fondo": _a_pct((ventanas.get(ventana) or {}).get("fund"))}
            for ventana, clave in (("1y", "1a"), ("3y", "3a_anualizada"), ("5y", "5a_anualizada"), ("10y", "10a_anualizada"))
        },
    }


def documento_de_serie_viejo(datos: dict) -> dict:
    """Un anio de `price_series` con la forma que espera el motor de carteras.

    La divisa se declara tal cual. El motor solo acepta EUR, asi que una serie en otra divisa
    se excluye nombrando el motivo: aqui no se convierte ni se da por euros.
    """
    return {
        "document_id": datos.get("year"),
        "schema_version": ESQUEMA_SERIE_VIEJO,
        "asset_id": datos.get("instrument_id"),
        "currency": datos.get("currency"),
        "source_currency": datos.get("currency"),
        "series_type": "NAV" if datos.get("price_class") == "NAV" else "ADJUSTED_CLOSE",
        "source_listing_id": datos.get("series_id"),
        "first_date": datos.get("first_date"),
        "last_date": datos.get("last_date"),
        "observations_count": datos.get("observations"),
        "points": datos.get("points") or [],
    }


class LectorOptimizacionBaseNueva:
    """Raices y series de la base nueva para optimizacion, backtest y cartera real."""

    max_parallel_reads = 6
    read_timeout_seconds = PLAZO_LECTURA_SEGUNDOS

    def __init__(self, db=None):
        self.db = db or get_master_db()
        self._activos = LectorBaseNueva(self.db)
        self.read_count = 0
        self.write_count = 0
        self._cerrojo = threading.Lock()
        self._monedas_sin_cambios = set()
        self._estr_sin_serie = {}

    def get_asset(self, asset_id: str) -> Optional[dict]:
        return self.get_assets_many([asset_id]).get(asset_id) if _valid_asset_id(asset_id) else None

    def get_search_index(self) -> Optional[dict]:
        """El indice del buscador, el mismo que `LectorBaseNueva`. Lo usa la cartera real para identificar por
        nombre los activos historicos del broker que no estan en su tabla manual (decision B-71)."""
        return self._activos.get_search_index()

    def get_assets_many(self, asset_ids) -> dict:
        """Las raices, con lo que hace falta saber para medir: si el fondo reparte (decision 8).

        Solo aqui y no en `LectorBaseNueva`, para que buscar en el catalogo no pague esa lectura.
        Vive en `declared/distributions.yield_12m`, en fraccion; `declared/dividends` es el de las
        acciones. Sin ese documento el fondo no trae rendimiento, y sigue dentro.

        A quien tiene rendimiento se le lee ademas lo que publica el proveedor, para saber si su serie ya
        lo iguala (decision 55). Son pocos, y a los demas no se les cobra esa lectura.
        """
        raices = self._activos.get_assets_many(asset_ids)
        fondos = [asset_id for asset_id, raiz in raices.items() if raiz.get("asset_type") == "FUND"]
        repartos = self._activos._datos_por_instrumento(fondos, "declared", "distributions")
        for asset_id, reparto in repartos.items():
            raices[asset_id]["performance"] = {"distributions": {"yield_12m_pct": _a_pct(reparto.get("yield_12m"))}}
        con_rendimiento = [asset_id for asset_id, reparto in repartos.items() if (_a_pct(reparto.get("yield_12m")) or 0) > 0]
        declarados = self._activos._datos_por_instrumento(con_rendimiento, "declared", "provider_returns")
        for asset_id, retornos in declarados.items():
            raices[asset_id]["performance"]["returns"] = retornos_viejos(retornos)
        return raices

    def get_reference_rate_points(self, rate: str) -> list:
        """[(fecha, tanto por uno), ...] de un tipo de referencia de la base. Solo hay €STR.

        Rendimiento construye con ella su referencia monetaria y el respaldo del libre de riesgo
        (decision B-70), en vez de un ETF monetario del catalogo.
        """
        if rate != "ESTR":
            return []
        return list(_estr_guardada(self.db, self._estr_sin_serie))

    def get_ecb_fx_points(self, currency: str) -> list:
        """[(fecha, divisa por euro), ...] del BCE: los mismos cambios con los que se pasan a euros las series (decision 10).

        Rendimiento convierte con ellos un traspaso en divisa (12-11-2026), para que la salida valga lo que vale el fondo
        ese dia en la serie con la que se mide. Una divisa en centimos devuelve los de su divisa mayor.
        """
        return list(self._cambios_de(MONEDAS_MENORES.get(currency, (currency, 1.0))[0]))

    def get_price_series(self, asset_id: str) -> list:
        if not _valid_asset_id(asset_id):
            return []
        snaps = self.db.collection("instruments").document(asset_id).collection("price_series").stream(
            **_plazo(self.read_timeout_seconds))
        documentos = [documento_de_serie_viejo(snap.to_dict() or {}) for snap in snaps]
        with self._cerrojo:
            self.read_count += max(1, len(documentos))
        salida = []
        for documento in documentos:
            en_euros = self._en_euros(documento)
            if en_euros is not None:
                salida.append(en_euros)
        return salida

    def _en_euros(self, documento: dict) -> Optional[dict]:
        """Sin ningun cambio de la moneda, la serie sigue en su divisa y el motor la excluye
        diciendo por que. Un anio anterior a los cambios del BCE (1999) se omite: si se
        devolviera sin convertir, el motor excluiria la serie entera por ese anio."""
        divisa = documento.get("currency")
        if not divisa or divisa == "EUR":
            return documento
        cambios = self._cambios_de(MONEDAS_MENORES.get(divisa, (divisa, 1.0))[0])
        return a_euros(documento, cambios) if cambios else documento

    def _cambios_de(self, moneda: str) -> list:
        # Una recarga a la vez por moneda (P1-12): los seis hilos de `portfolio_horizon` pedian la misma moneda a la vez y cada
        # uno la leia entera. El que llega segundo espera al cerrojo de la moneda y encuentra la cache llena.
        with _cerrojo_de_recarga(("fx", moneda)):
            ahora = time.monotonic()
            with _CERROJO_CAMBIOS:
                guardado = _CAMBIOS.get(moneda)
                if guardado and ahora - guardado[0] <= _TTL_CAMBIOS_SEGUNDOS:
                    return guardado[1]
            with self._cerrojo:
                if moneda in self._monedas_sin_cambios:
                    return []
            consulta = self.db.collection("fx_rates").where("currency", "==", moneda)
            puntos = {}
            for snap in consulta.stream(**_plazo(self.read_timeout_seconds)):
                for punto in (snap.to_dict() or {}).get("points") or []:
                    # Solo cambios que sirven para dividir; un hueco deja al punto sin cambio, que el motor descarta o dice.
                    if _cambio_valido(punto.get("value")):
                        puntos[punto["date"]] = punto["value"]
            cambios = sorted(puntos.items())
            if not cambios:
                # Un vacio no se guarda 15 minutos para todos: puede ser una lectura que no llego o una carga a medias. Solo se
                # recuerda en este lector, para que una peticion no lo pregunte una vez por serie.
                with self._cerrojo:
                    self._monedas_sin_cambios.add(moneda)
                return []
            with _CERROJO_CAMBIOS:
                _CAMBIOS[moneda] = (ahora, cambios)
            return cambios


_TTL_ESTR_SEGUNDOS = 15 * 60
_DIAS_DE_RETRASO_ADMITIDOS = 7
_ESTR_GUARDADA = {}
_CERROJOS_DE_RECARGA: dict = {}


def _cerrojo_de_recarga(clave) -> threading.Lock:
    with _CERROJO_CAMBIOS:
        return _CERROJOS_DE_RECARGA.setdefault(clave, threading.Lock())


def _estr_guardada(db, sin_serie: Optional[dict] = None) -> list:
    """[(fecha, tanto por uno), ...] de `reference_rates`, como la guarda la base.

    La leen la media de la ventana (en por ciento, que es como la calcula el BCE) y el indice
    capitalizado de Rendimiento (decision B-70), con la misma cache.

    La recarga va de una en una, y una serie vacia no se guarda en la cache compartida (P1-12). `sin_serie` es la memoria de quien
    llama —un lector, un resolvedor— para no volver a preguntar lo mismo dentro de su vida.
    """
    with _cerrojo_de_recarga(("estr",)):
        ahora = time.monotonic()
        with _CERROJO_CAMBIOS:
            guardada = _ESTR_GUARDADA.get("ESTR")
            if guardada and ahora - guardada[0] <= _TTL_ESTR_SEGUNDOS:
                return guardada[1]
        if sin_serie is not None and sin_serie.get("vacia"):
            return []
        puntos = {}
        for snap in db.collection("reference_rates").where("rate", "==", "ESTR").stream(**_plazo()):
            for punto in (snap.to_dict() or {}).get("points") or []:
                puntos[punto["date"]] = punto["value"]
        observaciones = sorted((date.fromisoformat(fecha), valor) for fecha, valor in puntos.items())
        if not observaciones:
            if sin_serie is not None:
                sin_serie["vacia"] = True
            return []
        with _CERROJO_CAMBIOS:
            _ESTR_GUARDADA["ESTR"] = (ahora, observaciones)
        return observaciones


def _media_de_la_serie_guardada(db, inicio: str, fin: str, sin_serie: Optional[dict] = None) -> Optional[dict]:
    """La media de la ventana con lo guardado, y si la serie llega a tiempo. Sin serie, None.

    El calculo del BCE alarga la ultima observacion hasta el final de la ventana y dice que la
    cubre entera. Con una serie guardada eso esconderia que esta atrasada, asi que aqui la
    cobertura solo cuenta los dias hasta la ultima observacion, mas los que tardaria en publicarse.
    """
    observaciones = _estr_guardada(db, sin_serie)
    ventana_inicio, ventana_fin = date.fromisoformat(inicio), date.fromisoformat(fin)
    if not observaciones or observaciones[-1][0] < ventana_inicio:
        return None
    media = _weighted_average_percent(
        [(dia, valor * 100) for dia, valor in observaciones if dia >= ventana_inicio - timedelta(days=14)],
        ventana_inicio, ventana_fin)
    retraso = (ventana_fin - observaciones[-1][0]).days
    media["al_dia"] = retraso <= _DIAS_DE_RETRASO_ADMITIDOS
    if not media["al_dia"]:
        total = (ventana_fin - ventana_inicio).days + 1
        media["coverage_ratio"] = round(min(media["coverage_ratio"], (total - retraso) / total), 6)
    return media


def resolver_tipo_libre(db=None):
    """Quien resuelve la media ESTR de una ventana.

    Manda la serie guardada en la base nueva, que se puede reproducir y no espera al BCE. Si esta
    atrasada se pregunta al BCE, y si tampoco contesta se usa lo guardado con su cobertura real,
    que es lo que hace salir el aviso de Sharpe aproximado. Solo sin serie queda el tipo fijo.
    Con otro proyecto declarado para (`exigir_base_nueva`): la base vieja ya no tiene lector.
    """
    exigir_base_nueva()
    cliente = db or get_master_db()
    sin_serie: dict = {}

    def resolver(inicio: str, fin: str) -> dict:
        guardada = _media_de_la_serie_guardada(cliente, inicio, fin, sin_serie)
        if guardada is not None and guardada.pop("al_dia"):
            return guardada
        try:
            return resolve_estr_window_average(inicio, fin)
        except Exception:
            if guardada is None:
                raise
            return guardada

    return resolver


def lector_de_optimizacion():
    """Como `lector_de_activos`, para quien ademas necesita las series."""
    exigir_base_nueva()
    return LectorOptimizacionBaseNueva()


def lector_de_activos():
    """El lector de la base nueva. Con otro proyecto en MASTER_PROJECT_ID para, nombrandolo
    (`master_project.exigir_base_nueva`): desde el 21-11-2026 no hay lector de la base vieja."""
    exigir_base_nueva()
    return LectorBaseNueva()
