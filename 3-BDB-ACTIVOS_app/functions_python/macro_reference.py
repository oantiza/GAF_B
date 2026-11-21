# -*- coding: utf-8 -*-
"""
Referencias macro publicas para el Comparador Patrimonial.
- Inflacion (IPC) del INE (API JSON Tempus3, servicios.ine.es).
- Rentabilidad de la deuda publica espanola (10A) del BCE (ECB Data Portal).
  (Las Letras del Tesoro del BdE bloquean peticiones automaticas.)
Solo lectura. NUNCA lanza: cualquier fallo se reporta en `notes` (diagnostico).
"""
import json
import math
import threading
import time
import urllib.request
from datetime import date, datetime
from quietlog import swallowed

# Auditoría 11-08 (D13): se elimina el socket.setdefaulttimeout(8) global, que
# afectaba a TODO el proceso (cualquier otro modulo importado despues). Cada
# peticion de este modulo ya pasa su timeout=8 explicito por llamada.

# La convencion de anio del proyecto, la de src/core/xirr.ts: la TIR no cambia al pulsar el boton.
DIAS_POR_ANIO = 365.2425
INE_IPC_SERIE = "IPC251852"  # NIVEL del indice IPC general nacional (base 2021=100)
# BCE (ECB Data Portal): rentabilidad deuda publica ES 10 anos (convergencia), mensual %.
ECB_GOV_FLOW = "IRS"
ECB_GOV_KEY = "M.ES.L.L40.CI.0000.EUR.N.Z"
_UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/csv, text/plain, */*",
    "Accept-Language": "es-ES,es;q=0.9",
}

# Auditoría 11-08 (D13): caché en memoria de 6 h del resultado completo, por
# payload de peticion (mismo patrón que _estr_average_cache en ecb_rates.py),
# con cota de tamaño pequeña y evicción simple por orden de inserción. INE y
# BdE publican como mucho una vez al día; solo se cachean respuestas limpias
# (sin notas de error) para no fijar un fallo transitorio durante horas.
_RESULT_CACHE_TTL_SECONDS = 6 * 60 * 60
_RESULT_CACHE_MAX_ENTRIES = 16
_result_cache = {}
_result_cache_lock = threading.Lock()


def _result_cache_get(key):
    if key is None:
        return None
    now = time.monotonic()
    with _result_cache_lock:
        cached = _result_cache.get(key)
        if cached and now - cached[0] < _RESULT_CACHE_TTL_SECONDS:
            return dict(cached[1])
    return None


def _result_cache_put(key, value):
    if key is None:
        return
    with _result_cache_lock:
        if key not in _result_cache:
            while len(_result_cache) >= _RESULT_CACHE_MAX_ENTRIES:
                _result_cache.pop(next(iter(_result_cache)))
        _result_cache[key] = (time.monotonic(), dict(value))


def _http_json(url, timeout=8):
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_text(url, timeout=8):
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _to_float(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        value = float(v)
        return value if math.isfinite(value) else None
    if isinstance(v, str):
        t = v.strip().replace(",", ".")
        try:
            value = float(t)
            return value if math.isfinite(value) else None
        except ValueError:
            return None
    return None


def _ine_inflation(start_date, end_date):
    """El IPC del periodo, desde el dia 1 del mes de `start_date`.

    El dato de un mes lleva fecha de su dia 1, asi que pedido desde el dia 15 no llega, y el flujo de
    ese mes se quedaba sin deflactar: con una sola aportacion, la TIR real salia igual que la nominal.
    """
    s = (start_date or "").replace("-", "")
    e = (end_date or "").replace("-", "")
    if len(s) != 8 or len(e) != 8:
        raise ValueError("fechas invalidas")
    s = s[:6] + "01"
    url = "https://servicios.ine.es/wstempus/js/ES/DATOS_SERIE/%s?date=%s:%s" % (INE_IPC_SERIE, s, e)
    data = _http_json(url)
    points = data.get("Data") if isinstance(data, dict) else (data if isinstance(data, list) else None)
    if isinstance(points, list) and points and isinstance(points[0], dict) and "Data" in points[0]:
        points = points[0].get("Data")
    if not isinstance(points, list) or not points:
        raise ValueError("respuesta INE sin Data")
    rows = []
    for p in points:
        if isinstance(p, dict):
            v = p.get("Valor")
            f = p.get("Fecha")
            if (isinstance(v, (int, float)) and not isinstance(v, bool)
                    and isinstance(f, (int, float)) and not isinstance(f, bool)
                    and math.isfinite(float(v)) and float(v) > 0):
                try:
                    year = int(p.get("Anyo"))
                    month = int(p.get("FK_Periodo"))
                    if not (1 <= month <= 12):
                        raise ValueError
                    month_key = "%04d-%02d" % (year, month)
                except (TypeError, ValueError):
                    month_key = datetime.utcfromtimestamp(float(f) / 1000.0).strftime("%Y-%m")
                rows.append((float(f), float(v), month_key))
    if len(rows) < 2:
        raise ValueError("INE: <2 puntos validos")
    rows.sort(key=lambda r: r[0])
    first_f, first_v, _ = rows[0]
    last_f, last_v, _ = rows[-1]
    total = last_v / first_v - 1.0
    years = max((last_f - first_f) / (DIAS_POR_ANIO * 24 * 3600 * 1000.0), 1e-6)
    annual = (1.0 + total) ** (1.0 / years) - 1.0
    # Se conserva el mapa mensual para deflactar cada flujo como hacía el
    # comparador legacy (endpoints_xray_comparador.py, líneas 656-680). El
    # último punto se elige cronológicamente, no por el mayor nivel del índice,
    # para que un período deflacionario siga siendo representable.
    ipc_monthly = {month_key: value for _, value, month_key in rows}
    return {"total_pct": total * 100.0, "annual_pct": annual * 100.0,
            "ipc_start": first_v, "ipc_end": last_v,
            "ipc_monthly": ipc_monthly}


def _bde_letras(start_date, end_date):
    """Rentabilidad media de Letras del Tesoro ES a 1 año (BdE, diaria)."""
    import gzip
    url = "https://app.bde.es/bierest/resources/srdatosapp/listaSeries?idioma=es&series=D_DTES00U7&rango=12M"
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=8) as resp:
        body = resp.read()
        try:
            body = gzip.decompress(body)
        except Exception:
            swallowed("macro_reference.py:146")
            pass
        data = json.loads(body.decode("utf-8"))

    if not data or not isinstance(data, list):
        raise ValueError("BDE sin datos")

    fechas = data[0].get("fechas", [])
    valores = data[0].get("valores", [])

    if not fechas or not valores:
        raise ValueError("BDE sin observaciones")

    nums = [v for v in valores if isinstance(v, (int, float))]
    if not nums:
        raise ValueError("BDE sin valores numericos")

    # Ultima fecha con dato numerico (texto tal como lo da el BdE).
    # El BdE las da de la mas reciente a la mas antigua: se toma la mayor, no la ultima de la lista.
    with_value = [str(f)[:10] for f, v in zip(fechas, valores)
                  if isinstance(v, (int, float)) and f is not None]
    last_date = max(with_value) if with_value else None
    return sum(nums) / len(nums), last_date


# =========================================================
# Comparador patrimonial: Depositos + fiscalidad (paridad legacy corregida)
#
# Fuentes legacy, ambas dentro de `_legacy/bdb-fondos`:
# - `functions_python/api/endpoints_xray_comparador.py`: curva de depositos
#   (lineas 140-158), ACT/360 y renovacion anual (161-217), Letras (269-336),
#   y deflactor por flujo mensual del IPC (656-680).
# - `frontend/src/utils/retirementUtils.ts`: escala marginal de la base del
#   ahorro 2026 (lineas 115-142; umbrales y tipos exactos en 120-130).
#
# IMPORTANTE: el endpoint legacy reducia la fiscalidad a un 20 % plano
# (`impuesto_bizkaia = 0.20`, linea 580). Por resolucion de revision F3 esa
# simplificacion se SUSTITUYE deliberadamente por la escala progresiva de
# `retirementUtils.ts`; no se conserva como fallback ni como metadato.
# Todas las funciones de este bloque son PURAS: sin red, sin Firestore.
# =========================================================

# Cada tupla contiene (umbral inferior en EUR, tipo marginal decimal).
BIZKAIA_TAX_BRACKETS = (
    (0.0, 0.19),
    (7_500.0, 0.20),
    (15_000.0, 0.22),
    (30_000.0, 0.24),
    (50_000.0, 0.255),
    (90_000.0, 0.26),
    (120_000.0, 0.265),
    (240_000.0, 0.27),
    (300_000.0, 0.28),
)

# Curva estatica de tipos medios de depositos bancarios ES (% anual).
# Portada TAL CUAL del legacy (endpoints_xray_comparador.py l.140-147,
# "DEPOSIT RATE CURVE (hardcoded, no external API)").
DEPOSIT_RATES_BY_YEAR = {
    2005: 2.00, 2006: 2.25, 2007: 3.00, 2008: 3.50,
    2009: 2.00, 2010: 1.50, 2011: 2.00, 2012: 1.75,
    2013: 1.25, 2014: 0.75, 2015: 0.30, 2016: 0.10,
    2017: 0.05, 2018: 0.05, 2019: 0.05, 2020: 0.05,
    2021: 0.05, 2022: 0.75, 2023: 2.00, 2024: 2.50,
    2025: 2.25, 2026: 2.00,
}

# Tasas medias anuales de Letras del Tesoro a 12 meses (% anual).
# Portadas TAL CUAL del legacy (_LETRAS_FALLBACK_RATES, l.97-105; fuente:
# Tesoro Publico). Se usan para la SIMULACION plurianual historica; el campo
# `letras_avg_rate_pct` de esta callable (media BdE ultimos 12M) se mantiene
# solo como referencia informativa.
LETRAS_RATES_BY_YEAR = {
    2000: 4.32, 2001: 3.71, 2002: 3.13, 2003: 2.19,
    2004: 2.17, 2005: 2.28, 2006: 3.26, 2007: 4.13,
    2008: 3.72, 2009: 1.02, 2010: 1.67, 2011: 3.31,
    2012: 2.62, 2013: 1.25, 2014: 0.41, 2015: 0.05,
    2016: -0.19, 2017: -0.35, 2018: -0.32, 2019: -0.39,
    2020: -0.46, 2021: -0.50, 2022: 0.70, 2023: 3.38,
    2024: 3.41, 2025: 2.50, 2026: 2.50,
}


def impuesto_ahorro_bizkaia(beneficio):
    """Cuota marginal de Bizkaia sobre una ganancia del ahorro positiva.

    Los limites son umbrales inferiores: cada porcion tributa al tipo de su
    tramo. Las perdidas no generan credito fiscal. Funcion pura.
    """
    taxable = _to_float(beneficio)
    if taxable is None or taxable <= 0:
        return 0.0

    tax = 0.0
    for index, (lower, rate) in enumerate(BIZKAIA_TAX_BRACKETS):
        upper = (BIZKAIA_TAX_BRACKETS[index + 1][0]
                 if index + 1 < len(BIZKAIA_TAX_BRACKETS) else None)
        if taxable <= lower:
            break
        portion = taxable - lower if upper is None else min(taxable, upper) - lower
        tax += portion * rate
        if upper is None or taxable <= upper:
            break
    return tax


def bizkaia_tax_brackets_payload():
    """Escala fiscal serializable para que la interfaz no invente un tipo fijo."""
    return [
        {"threshold_eur": threshold, "rate_pct": round(rate * 100.0, 3)}
        for threshold, rate in BIZKAIA_TAX_BRACKETS
    ]


def _tasa_anual(tabla, year):
    """Tipo anual (decimal) para un año; fuera de rango usa el mas cercano
    (misma politica que `_get_deposit_rate` del legacy, l.150-158)."""
    if year in tabla:
        return tabla[year] / 100.0
    years = sorted(tabla)
    if year < years[0]:
        return tabla[years[0]] / 100.0
    return tabla[years[-1]] / 100.0


def _normalize_flows(aportaciones, fecha_final):
    """Valida y ordena aportaciones para las funciones puras de simulacion."""
    if isinstance(fecha_final, datetime):
        fecha_final = fecha_final.date()
    if not isinstance(fecha_final, date):
        raise ValueError("fecha final invalida")

    flows = []
    for item in aportaciones or []:
        if not isinstance(item, (tuple, list)) or len(item) != 2:
            raise ValueError("aportacion invalida")
        flow_date, amount = item
        if isinstance(flow_date, datetime):
            flow_date = flow_date.date()
        value = _to_float(amount)
        if not isinstance(flow_date, date) or value is None or flow_date > fecha_final:
            raise ValueError("aportacion invalida")
        if abs(value) >= 0.005:
            flows.append((flow_date, value))
    return sorted(flows, key=lambda pair: pair[0]), fecha_final


def _simular_renta_fija(aportaciones, fecha_final, tabla_tasas,
                        tasa_fija_pct=None, liquidacion_anual=False):
    """Nucleo comun ACT/360 de Letras y depositos.

    - `aportaciones`: lista de (datetime.date, importe); importe > 0 = entrada.
    - Devengo diario ACT/360, troceado en cada 1 de enero (igual que el
      legacy: `interes = max(0, saldo) * tasa * dias/360`).
    - Deposito (`liquidacion_anual=True`): al cierre de cada año natural se
      liquida la escala progresiva sobre el beneficio del periodo; el año
      parcial final tambien tributa (mecanica legacy, lineas 201-212).
    - Letras (`liquidacion_anual=False`): acumula el saldo bruto y liquida la
      escala progresiva una sola vez al vencimiento, segun resolucion F3.
    - Pista BRUTA: mismo devengo sin impuestos (legacy `valor_bruto`).

    Devuelve (valor_neto, valor_bruto, intereses_brutos, impuestos). Funcion
    pura. `intereses_brutos` incluye intereses negativos, que compensan la
    ganancia antes de la liquidacion unica de Letras.
    """
    flows, fecha_final = _normalize_flows(aportaciones, fecha_final)
    fixed_rate = _to_float(tasa_fija_pct) if tasa_fija_pct is not None else None
    if tasa_fija_pct is not None and fixed_rate is None:
        raise ValueError("tipo fijo invalido")
    saldo_neto = 0.0
    saldo_bruto = 0.0
    beneficio_periodo = 0.0
    intereses_brutos = 0.0
    impuestos = 0.0

    fechas = [d for d, _ in flows] + [fecha_final]
    importes = [a for _, a in flows]

    for i in range(len(fechas) - 1):
        actual = fechas[i]
        siguiente = fechas[i + 1]
        aport = importes[i] if i < len(importes) else 0.0
        saldo_neto += aport
        saldo_bruto += aport

        cur = actual
        while cur < siguiente:
            boundary = date(cur.year + 1, 1, 1)
            step_end = min(siguiente, boundary)
            dias = (step_end - cur).days

            if fixed_rate is not None:
                tasa = fixed_rate / 100.0
            else:
                tasa = _tasa_anual(tabla_tasas, cur.year)

            int_neto = max(0.0, saldo_neto) * tasa * (dias / 360.0)
            int_bruto = max(0.0, saldo_bruto) * tasa * (dias / 360.0)

            beneficio_periodo += int_neto
            intereses_brutos += int_bruto

            saldo_neto += int_neto
            saldo_bruto += int_bruto

            if liquidacion_anual and step_end == boundary:
                tax = impuesto_ahorro_bizkaia(beneficio_periodo)
                saldo_neto -= tax
                impuestos += tax
                beneficio_periodo = 0.0

            cur = step_end

    if liquidacion_anual:
        # Año parcial final (legacy: "Final partial-year tax", lineas 209-212).
        tax = impuesto_ahorro_bizkaia(beneficio_periodo)
        saldo_neto -= tax
        impuestos += tax
    else:
        # Letras: fiscalidad diferida y unica sobre la ganancia acumulada.
        tax = impuesto_ahorro_bizkaia(intereses_brutos)
        saldo_neto = saldo_bruto - tax
        impuestos = tax

    return saldo_neto, saldo_bruto, intereses_brutos, impuestos


def simulate_deposito(aportaciones, fecha_final, rate_pct=None):
    """Simulacion del deposito bancario (paridad con simulate_depositos legacy).

    `rate_pct`: tipo % anual fijo elegido por el usuario; si es None se usa la
    curva estatica anual del legacy (DEPOSIT_RATES_BY_YEAR). Funcion pura.
    """
    fixed_rate = _to_float(rate_pct) if rate_pct is not None else None
    if rate_pct is not None and (fixed_rate is None or not (-5.0 <= fixed_rate <= 25.0)):
        raise ValueError("tipo de deposito fuera del rango -5..25")
    neto, bruto, intereses, impuestos = _simular_renta_fija(
        aportaciones, fecha_final, DEPOSIT_RATES_BY_YEAR,
        tasa_fija_pct=fixed_rate, liquidacion_anual=True,
    )
    return {"valor_neto": neto, "valor_bruto": bruto,
            "intereses_brutos": intereses, "impuestos": impuestos}


def simulate_letras(aportaciones, fecha_final):
    """Simulacion de Letras del Tesoro 12M con la curva estatica anual del
    legacy (paridad con simulate_letras legacy). Funcion pura."""
    neto, bruto, intereses, impuestos = _simular_renta_fija(
        aportaciones, fecha_final, LETRAS_RATES_BY_YEAR,
        liquidacion_anual=False,
    )
    return {"valor_neto": neto, "valor_bruto": bruto,
            "intereses_brutos": intereses, "impuestos": impuestos}


def xirr(cashflows):
    """TIR (XIRR) con Newton-Raphson y respaldo de biseccion.

    `cashflows`: lista de (datetime.date, importe) en convenio XIRR
    (aportacion negativa, valor final positivo). Devuelve tasa decimal o None
    si no converge / flujos invalidos. Funcion pura (equivalente stdlib del
    pyxirr.xirr que usaba el legacy, con la misma politica: None en fallo).
    """
    flows = sorted(((d, float(a)) for d, a in cashflows), key=lambda p: p[0])
    if len(flows) < 2:
        return None
    if not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    t0 = flows[0][0]

    def npv(rate):
        total = 0.0
        for d, a in flows:
            years = (d - t0).days / DIAS_POR_ANIO
            total += a / (1.0 + rate) ** years
        return total

    rate = 0.1
    for _ in range(80):
        try:
            f = npv(rate)
            df = (npv(rate + 1e-6) - f) / 1e-6
        except (OverflowError, ZeroDivisionError):
            break
        if abs(df) < 1e-12:
            break
        nxt = rate - f / df
        if not math.isfinite(nxt):
            break
        if abs(nxt - rate) < 1e-9:
            return nxt if nxt > -1.0 else None
        rate = -0.5 if nxt < -0.999 else nxt

    lo, hi = -0.95, 5.0
    try:
        flo, fhi = npv(lo), npv(hi)
    except (OverflowError, ZeroDivisionError):
        return None
    if flo * fhi > 0:
        if math.isfinite(rate) and -1.0 < rate:
            try:
                if abs(npv(rate)) < 1e-6:
                    return rate
            except (OverflowError, ZeroDivisionError):
                return None
        return None
    for _ in range(200):
        mid = (lo + hi) / 2.0
        v = npv(mid)
        if abs(v) < 1e-9:
            return mid
        if flo * v < 0:
            hi = mid
        else:
            lo, flo = mid, v
    return (lo + hi) / 2.0


def tir_real_por_ipc(cashflows, ipc_monthly, fecha_final):
    """TIR real deflactando cada flujo historico por `IPC_final / IPC_t`.

    Replica la mecanica legacy de `endpoints_xray_comparador.py` lineas
    656-680, corrigiendo la seleccion del IPC final: se toma el ultimo mes
    cronologico, no el mayor valor del indice. Asi una inflacion negativa
    produce correctamente una TIR real superior a la nominal.

    Si falta el IPC del mes de un flujo no hay TIR real, y devuelve None: el
    legacy usaba factor 1, que publica como real una cifra sin deflactar. Es lo
    que pasa con una aportacion posterior al ultimo IPC publicado.
    """
    if not isinstance(ipc_monthly, dict) or not ipc_monthly:
        return None
    if isinstance(fecha_final, datetime):
        fecha_final = fecha_final.date()
    if not isinstance(fecha_final, date):
        return None

    valid_ipc = {}
    for month_key, raw_value in ipc_monthly.items():
        if not isinstance(month_key, str):
            continue
        try:
            datetime.strptime(month_key, "%Y-%m")
        except ValueError:
            continue
        value = _to_float(raw_value)
        if value is not None and value > 0:
            valid_ipc[month_key] = value
    if not valid_ipc:
        return None

    final_key = fecha_final.strftime("%Y-%m")
    eligible_keys = [key for key in valid_ipc if key <= final_key]
    latest_key = max(eligible_keys or valid_ipc.keys())
    latest_ipc = valid_ipc[latest_key]

    real_flows = []
    for flow_date, amount in cashflows:
        if isinstance(flow_date, datetime):
            flow_date = flow_date.date()
        value = _to_float(amount)
        if not isinstance(flow_date, date) or value is None:
            return None
        # El valor terminal ya esta expresado en euros de fecha final. Los
        # flujos historicos se llevan a esos euros.
        if flow_date < fecha_final:
            ipc_t = valid_ipc.get(flow_date.strftime("%Y-%m"))
            if ipc_t is None:
                return None
            value *= latest_ipc / ipc_t
        real_flows.append((flow_date, value))
    return xirr(real_flows)


def meses_sin_ipc(aportaciones, ipc_monthly, fecha_final):
    """Los meses de las aportaciones de los que el INE no ha dado IPC, para poder decir por que no hay TIR real."""
    conocidos = ipc_monthly if isinstance(ipc_monthly, dict) else {}
    return sorted({d.strftime("%Y-%m") for d, _ in aportaciones if d < fecha_final} - set(conocidos))


def _round_or_none(value, ndigits=2):
    if value is None:
        return None
    return round(float(value), ndigits)


def _alternativa(aportaciones, fecha_final, valor_bruto, valor_neto, ipc_monthly):
    """TIR nominal/real, bruta/neta de una alternativa a partir de sus valores
    finales. Convenio XIRR: aportaciones en negativo, valor final positivo."""
    base = [(d, -a) for d, a in aportaciones]
    tir_bruta = xirr(base + [(fecha_final, valor_bruto)])
    tir_neta = xirr(base + [(fecha_final, valor_neto)])
    real_bruta = tir_real_por_ipc(base + [(fecha_final, valor_bruto)],
                                  ipc_monthly, fecha_final)
    real_neta = tir_real_por_ipc(base + [(fecha_final, valor_neto)],
                                 ipc_monthly, fecha_final)

    def _pct(value):
        return _round_or_none(value * 100.0) if value is not None else None

    return {
        "valor_final_bruto": _round_or_none(valor_bruto),
        "valor_final_neto": _round_or_none(valor_neto),
        "tir_nominal_bruta_pct": _pct(tir_bruta),
        "tir_nominal_neta_pct": _pct(tir_neta),
        "tir_real_bruta_pct": _pct(real_bruta),
        "tir_real_neta_pct": _pct(real_neta),
    }


def build_patrimonial_comparison(aportaciones, valor_final, fecha_final,
                                 deposit_rate_pct=None, ipc_monthly=None):
    """Comparativa patrimonial de las 3 alternativas (paridad legacy).

    - Cartera: impuesto progresivo una sola vez al final sobre la plusvalia.
    - Letras: curva legacy ACT/360 e impuesto progresivo unico al vencimiento.
    - Deposito: tipo fijo o curva legacy, con liquidacion fiscal anual y final.
    - TIR real: flujos deflactados mes a mes con IPC INE.

    Funcion pura. Devuelve dict con las 3 alternativas.
    """
    try:
        flows, fecha_final = _normalize_flows(aportaciones, fecha_final)
    except ValueError:
        return None
    valor_final = _to_float(valor_final)
    deposit_rate_pct = (_to_float(deposit_rate_pct)
                        if deposit_rate_pct is not None else None)
    if (not flows or valor_final is None or valor_final <= 0
            or (deposit_rate_pct is not None
                and not (-5.0 <= deposit_rate_pct <= 25.0))):
        return None

    total_aportado = sum(a for _, a in flows)
    plusvalia = valor_final - total_aportado
    cartera_neto = valor_final - impuesto_ahorro_bizkaia(plusvalia)

    letras = simulate_letras(flows, fecha_final)
    deposito = simulate_deposito(flows, fecha_final, rate_pct=deposit_rate_pct)

    return {
        "cartera": _alternativa(flows, fecha_final, valor_final, cartera_neto,
                                ipc_monthly),
        "letras": _alternativa(flows, fecha_final, letras["valor_bruto"],
                               letras["valor_neto"], ipc_monthly),
        "deposito": _alternativa(flows, fecha_final, deposito["valor_bruto"],
                                  deposito["valor_neto"], ipc_monthly),
    }


def _parse_iso_date(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        text = value.strip()
        if len(text) != 10:
            return None
        try:
            return datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _parse_comparison_request(request):
    """Extrae (aportaciones, valor_final, fecha_final, deposit_rate_pct) del
    payload de la callable; devuelve None si no se pide comparativa."""
    if not isinstance(request, dict):
        return None
    raw_flows = request.get("flows")
    if not isinstance(raw_flows, list) or not raw_flows or len(raw_flows) > 1_000:
        return None
    valor_final = _to_float(request.get("final_value"))
    if valor_final is None or not (0 < valor_final <= 1_000_000_000_000.0):
        return None
    fecha_final = _parse_iso_date(request.get("end_date"))
    if fecha_final is None:
        return None
    aportaciones = []
    for item in raw_flows:
        if not isinstance(item, dict):
            continue
        d = _parse_iso_date(item.get("date"))
        a = _to_float(item.get("amount"))
        if (d is None or a is None or abs(a) < 0.005
                or abs(a) > 1_000_000_000_000.0 or d > fecha_final):
            continue
        aportaciones.append((d, a))
    if not aportaciones:
        return None
    raw_rate = request.get("deposit_rate_pct")
    rate = _to_float(raw_rate)
    if raw_rate is not None and (rate is None or not (-5.0 <= rate <= 25.0)):
        raise ValueError("tipo de deposito fuera del rango -5..25")
    return aportaciones, valor_final, fecha_final, rate


def _primera_aportacion(start_date, raw_flows):
    """La fecha desde la que hace falta IPC: la mas antigua entre la pedida y las aportaciones."""
    fechas = [_parse_iso_date(start_date)]
    if isinstance(raw_flows, list):
        fechas.extend(_parse_iso_date(item.get("date")) for item in raw_flows[:1_000] if isinstance(item, dict))
    validas = [fecha for fecha in fechas if fecha is not None]
    return min(validas).isoformat() if validas else start_date


# Los años hasta aqui son datos de una tabla fija heredada del legacy; los
# posteriores son SUPUESTOS (hallazgo 27). Cambiarlo es decision de producto.
TABLE_MEASURED_THROUGH_YEAR = 2024
BIZKAIA_TAX_FISCAL_YEAR = 2026


def _rate_kind(year):
    return "TABLE" if year <= TABLE_MEASURED_THROUGH_YEAR else "ASSUMPTION"


def _rate_tables_payload():
    def one(tabla):
        return {
            "kind": "TABLE",
            "measured_through_year": TABLE_MEASURED_THROUGH_YEAR,
            "assumed_years": sorted(y for y in tabla if y > TABLE_MEASURED_THROUGH_YEAR),
            "last_year": max(tabla),
            "origin": "tabla fija escrita en el código (heredada del sistema anterior), no una consulta",
        }
    return {"deposit": one(DEPOSIT_RATES_BY_YEAR), "letras": one(LETRAS_RATES_BY_YEAR)}


def _rates_used(aportaciones, fecha_final):
    """Los tipos por año que entran en la simulacion, cada uno con lo que es."""
    first = min(d for d, _ in aportaciones).year
    out = []
    for year in range(first, fecha_final.year + 1):
        out.append({
            "year": year,
            "deposit_pct": round(_tasa_anual(DEPOSIT_RATES_BY_YEAR, year) * 100.0, 4),
            "letras_pct": round(_tasa_anual(LETRAS_RATES_BY_YEAR, year) * 100.0, 4),
            "kind": _rate_kind(year),
        })
    return out


def _letras_result(raw):
    """`_bde_letras` devuelve (media, ultima_fecha); se acepta tambien un numero suelto."""
    if isinstance(raw, tuple):
        return float(raw[0]), (raw[1] if len(raw) > 1 else None)
    return float(raw), None


def _letras_matches_request(start_date, end_date, last_data):
    """La media de Letras son SIEMPRE los ultimos 12 meses del BdE; coincide con lo pedido
    solo si el periodo pedido es de ~12 meses y acaba cerca del ultimo dato."""
    s = _parse_iso_date(start_date)
    e = _parse_iso_date(end_date)
    last = _parse_iso_date(last_data)
    if s is None or e is None or last is None:
        return False
    return (e - s).days <= 366 + 31 and abs((e - last).days) <= 31


def _fetch_sources(ine_start, start_date, end_date):
    """Consulta INE y BdE. Devuelve lo que contestaron y los fallos; solo lo limpio se cachea."""
    res = {"infl": None, "letras": None, "letras_last": None, "errors": []}
    try:
        res["infl"] = _ine_inflation(ine_start, end_date)
    except Exception as exc:
        res["errors"].append("IPC (INE): %s" % str(exc)[:140])
    try:
        res["letras"], res["letras_last"] = _letras_result(_bde_letras(start_date, end_date))
    except Exception as exc:
        res["errors"].append("Letras ES (BdE): %s" % str(exc)[:140])
    return res


def get_macro_reference(request):
    request = request if isinstance(request, dict) else {}
    start_date = request.get("start_date")
    end_date = request.get("end_date")
    # La cache guarda solo lo que cambia con las FUENTES (INE y BdE), que depende de
    # las fechas y no de los flujos del cliente. La comparativa se calcula siempre.
    try:
        ine_start = _primera_aportacion(start_date, request.get("flows"))
        cache_key = repr((ine_start, str(end_date), str(start_date)))
    except Exception:
        ine_start, cache_key = start_date, None
    src = _result_cache_get(cache_key)
    if src is None:
        src = _fetch_sources(ine_start, start_date, end_date)
        if not src["errors"]:
            _result_cache_put(cache_key, src)

    out = {
        "inflation_annual_pct": None,
        "inflation_total_pct": None,
        "letras_avg_rate_pct": None,
        "source": "",
        "notes": "",
    }
    notes = list(src["errors"])
    sources = []
    ipc_monthly = None
    infl = src["infl"]
    if infl is not None:
        out["inflation_annual_pct"] = round(infl["annual_pct"], 3)
        out["inflation_total_pct"] = round(infl["total_pct"], 3)
        out["ipc_start"] = infl.get("ipc_start")
        out["ipc_end"] = infl.get("ipc_end")
        ipc_monthly = infl.get("ipc_monthly")
        last_month = max(ipc_monthly) if ipc_monthly else None
        sources.append({"name": "INE (IPC)", "status": "OK", "last_data": last_month})
    else:
        sources.append({"name": "INE (IPC)", "status": "ERROR", "last_data": None})
    if src["letras"] is not None:
        out["letras_avg_rate_pct"] = round(src["letras"], 3)
        sources.append({"name": "BdE (Letras del Tesoro 1A)", "status": "OK", "last_data": src["letras_last"]})
        matches = _letras_matches_request(start_date, end_date, src["letras_last"])
        out["letras_period"] = {
            "kind": "LAST_12_MONTHS",
            "last_data": src["letras_last"],
            "matches_request": matches,
            "note": (
                "Media simple de los últimos 12 meses publicados por el BdE"
                + (" (coincide con el periodo pedido)." if matches
                   else ", no del periodo pedido: es una referencia informativa.")
            ),
        }
    else:
        sources.append({"name": "BdE (Letras del Tesoro 1A)", "status": "ERROR", "last_data": None})
    ok = [x for x in sources if x["status"] == "OK"]
    out["sources"] = sources
    out["source"] = (
        " + ".join(
            "%s, último dato %s" % (x["name"], x["last_data"]) if x["last_data"] else x["name"]
            for x in ok
        ) or "Ninguna fuente respondió"
    )
    # --- Comparativa patrimonial (paridad legacy: Depositos + fiscalidad) ---
    try:
        parsed = _parse_comparison_request(request)
        if parsed is not None:
            aportaciones, valor_final, fecha_final, deposit_rate_pct = parsed
            out["bizkaia_tax_brackets"] = bizkaia_tax_brackets_payload()
            out["bizkaia_tax_scale"] = {
                "territory": "Bizkaia",
                "fiscal_year": BIZKAIA_TAX_FISCAL_YEAR,
                "kind": "FIXED_TABLE",
                "note": "Escala del ahorro de Bizkaia %s, fija en el código; no es la de otros territorios."
                % BIZKAIA_TAX_FISCAL_YEAR,
            }
            default_year = max(DEPOSIT_RATES_BY_YEAR)
            out["deposit_rate_default_pct"] = DEPOSIT_RATES_BY_YEAR[default_year]
            out["deposit_rate_default_year"] = default_year
            out["deposit_rate_default_kind"] = _rate_kind(default_year)
            out["deposit_rate_used_pct"] = deposit_rate_pct  # None = curva estatica legacy
            out["rate_tables"] = _rate_tables_payload()
            out["rates_used"] = _rates_used(aportaciones, fecha_final)
            out["comparison"] = build_patrimonial_comparison(
                aportaciones, valor_final, fecha_final,
                deposit_rate_pct=deposit_rate_pct,
                ipc_monthly=ipc_monthly,
            )
            faltan = meses_sin_ipc(aportaciones, ipc_monthly, fecha_final) if ipc_monthly else []
            if faltan:
                notes.append("TIR real no disponible: falta el IPC de %s." % ", ".join(faltan))
    except Exception as exc:
        notes.append("comparativa patrimonial: %s" % str(exc)[:140])
    out["notes"] = " · ".join(notes)
    return out
