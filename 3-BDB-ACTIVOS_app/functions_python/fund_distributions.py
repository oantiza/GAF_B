# -*- coding: utf-8 -*-
"""Los fondos que reparten y de los que no tenemos todos los pagos (decision 8 de Oscar, 04-11-2026).

La serie de un fondo es su valor liquidativo, y el de una clase que reparte baja cada vez que paga.
Dibujarla como si fuera su rentabilidad, o meterla en una simulacion, le resta lo que el cliente cobro
y no perdio: medido en 10 de estos fondos, entre 1,4 y 7,6 puntos al ano frente al proveedor.

**La regla es el rendimiento a 12 meses positivo, y no la politica declarada.** Con la politica salian
49 fondos, y 35 de ellos no tenian el problema: su serie no se separa del proveedor mas de 0,44 puntos.
Casi todos eran clases que acumulan y a las que el proveedor les lista algun pago, como Janus Henderson
Euroland A2, con uno de 2021 y rendimiento cero: lo dice su KID (decision 78). Con el rendimiento salen 14,
los mismos en las dos bases, y 9 de ellos los bloquea `fund_history_policies.json`: revisados uno a uno, se
dibujan y no se miden (decision 53).

Solo los fondos: un ETF va con cierre ajustado, que ya incluye lo que paga. Y un fondo sin dato de
rendimiento sigue dentro: no saber si reparte no es saber que reparte.

**La excepcion, la clase cuya serie ya iguala al proveedor** (decision 55). BNY Mellon H Acc tiene un
rendimiento del 4,97 % y su valor liquidativo no baja cuando el proveedor registra un pago: es una clase
que acumula, y a su serie no le falta nada. Esto se decide con lo guardado y no con una lista: cada ventana
publicada, al corte del proveedor y con su convencion, tiene que dar su cifra. Hace falta mas de una ventana
y la misma divisa, porque no saber si iguala no es saber que iguala.
"""
import bisect
import calendar
import math
from datetime import date
from typing import Optional

from metrics_reconciliation import (
    MATCH,
    NO_PROVIDER,
    comparable_basis,
    provider_cut_date,
    reconcile_windows,
)

MOTIVO_REPARTE = "DISTRIBUTES_WITHOUT_PAYMENTS"

# Las ventanas en las que se contrasta, en meses, como las publica el proveedor. A un ano no: un pago de hace 13 meses
# no se veria, y es la que menos dice de si a la serie le falta algo.
VENTANAS_DEL_CONTRASTE = {"3y": 36, "5y": 60, "10y": 120}
MINIMO_DE_VENTANAS = 2
# Puntos porcentuales al ano. La misma de `fund_return_basis`, que tambien contrasta cifras multianuales del proveedor.
# No es la de 1,0 de la reconciliacion de metricas, que busca fallos gordos: con 1,0 pasaria quien reparte poco
# (DWS Strategic Dynamic, 0,41 a 5 anos).
TOLERANCIA_PP = 0.10
# Lo mas lejos que puede estar el valor liquidativo del fin de mes que se busca, como en la medida de la revision.
MAX_DIAS_HASTA_EL_FIN_DE_MES = 10


def rendimiento_12m_pct(root: Optional[dict]) -> Optional[float]:
    """El rendimiento a 12 meses en porcentaje, o None si la raiz no lo trae.

    En la base vieja vive en `performance.distributions.yield_12m_pct`. En la nueva esta en
    `declared/distributions.yield_12m`, en fraccion, y el lector lo deja en el mismo sitio.
    """
    distribuciones = ((root or {}).get("performance") or {}).get("distributions")
    valor = distribuciones.get("yield_12m_pct") if isinstance(distribuciones, dict) else None
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        return None
    return float(valor)


def reparte_sin_todos_los_pagos(root: Optional[dict]) -> bool:
    """Si la raiz dice que a la serie de este activo le faltan los pagos, porque reparte."""
    if str((root or {}).get("asset_type") or "").strip().upper() != "FUND":
        return False
    rendimiento = rendimiento_12m_pct(root)
    return rendimiento is not None and rendimiento > 0


def _puntos_en_euros(documentos) -> Optional[list]:
    """La serie, ordenada, con la forma que pide la reconciliacion. Si algo no esta en euros, None."""
    por_fecha = {}
    for documento in documentos or []:
        if documento.get("currency") != "EUR":
            return None
        for punto in documento.get("points") or []:
            try:
                fecha, valor = str(punto["date"])[:10], float(punto["value"])
            except (KeyError, TypeError, ValueError):
                continue
            if valor > 0 and math.isfinite(valor):
                por_fecha[fecha] = valor
    return [{"date": fecha, "value": por_fecha[fecha]} for fecha in sorted(por_fecha)]


def _fin_de_mes_antes(corte: date, meses: int) -> date:
    anio, mes = divmod(corte.year * 12 + corte.month - 1 - meses, 12)
    return date(anio, mes + 1, calendar.monthrange(anio, mes + 1)[1])


def _ventana_como_el_proveedor(corte: date):
    """Rentabilidad anualizada de fin de mes a fin de mes y por anios justos, que es como mide el proveedor."""

    def calcular(puntos, etiqueta):
        meses = VENTANAS_DEL_CONTRASTE[etiqueta]
        fechas = [punto["date"] for punto in puntos]
        objetivo = _fin_de_mes_antes(corte, meses)
        indice = bisect.bisect_right(fechas, objetivo.isoformat()) - 1
        if indice < 0 or (objetivo - date.fromisoformat(fechas[indice])).days > MAX_DIAS_HASTA_EL_FIN_DE_MES:
            return None
        return {"annualized_return": (puntos[-1]["value"] / puntos[indice]["value"]) ** (12 / meses) - 1}

    return calcular


def contraste_con_el_proveedor(root: Optional[dict], documentos) -> dict:
    """Ventana a ventana, la serie guardada frente a lo que publica el proveedor. Vacio si no se puede contrastar.

    Se compara lo guardado con lo guardado: la serie y las cifras a varios anios de la raiz, al corte del proveedor.
    """
    corte = provider_cut_date(root)
    if corte is None or not comparable_basis(root):
        return {}
    puntos = _puntos_en_euros(documentos)
    if not puntos:
        return {}
    return reconcile_windows(root, puntos, _ventana_como_el_proveedor(date.fromisoformat(corte)),
                             labels=tuple(VENTANAS_DEL_CONTRASTE), tolerance_pp=TOLERANCIA_PP)


def serie_iguala_al_proveedor(root: Optional[dict], documentos) -> bool:
    """Si la serie guardada ya da la rentabilidad total que publica el proveedor (decision 55).

    Sin cifras del proveedor, en otra divisa, con la serie atrasada o con una sola ventana, no se puede afirmar: False.
    """
    publicadas = [nodo for nodo in contraste_con_el_proveedor(root, documentos).values() if nodo["verdict"] != NO_PROVIDER]
    return len(publicadas) >= MINIMO_DE_VENTANAS and all(nodo["verdict"] == MATCH for nodo in publicadas)
