"""Verificación de acceso a Morningstar — EJECUTAR EN TU PC.

    cd fondosdb
    python tools/test_morningstar.py

Prueba, en orden y sin tocar tu base de datos:
 1. Screener europeo (tools.morningstar.es) con la apikey pública.
 2. API lt.morningstar.com (snapshot/MiFID) con el SecId encontrado.
 3. Librería mstarpy (sal-service): búsqueda + 3 bloques de ejemplo.

Imprime PASS/FAIL por prueba y muestras de datos reales. Si la 3 funciona,
FondosDB podrá extraer los ~20 bloques de Morningstar de la Fase 1.
Si la 3 falla con 401, sube la espera de la sesión Selenium (PowerShell):
    $env:SELENIUM_DRIVER_WAIT_TIME="20"
y reintenta. Las pruebas 1 y 2 alimentan la fuente morningstar_lt, que no
necesita sesión.
"""
from __future__ import annotations

import json
import sys

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36")
ISIN_PRUEBA = "IE00B4L5Y983"  # iShares Core MSCI World


def paso(n, titulo):
    print(f"\n{'='*60}\nPASO {n}: {titulo}\n{'='*60}")


def main() -> int:
    resultados = {}

    # ------------------------------------------------ 1) screener europeo
    paso(1, "Screener europeo (tools.morningstar.es)")
    sec_id = None
    try:
        r = requests.get(
            "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener",
            params={
                "page": 1, "pageSize": 5, "sortOrder": "LegalName asc",
                "outputType": "json", "version": 1, "languageId": "es-ES",
                "currencyId": "EUR", "universeIds": "FOESP$$ALL",
                "securityDataPoints":
                    "SecId|Name|ISIN|OngoingCharge|StarRatingM255|"
                    "ReturnM12|ReturnM36|ReturnM60|LargestSector|CategoryName",
                "term": "Bestinfond",
            },
            headers={"User-Agent": UA, "Referer": "https://www.morningstar.es/"},
            timeout=25)
        rows = (r.json().get("rows") or []) if r.ok else []
        if rows:
            print(f"PASS - {len(rows)} resultados. Primero:")
            print(json.dumps(rows[0], indent=2, ensure_ascii=False)[:600])
            sec_id = rows[0].get("SecId")
            resultados["screener"] = True
        else:
            print(f"FAIL - HTTP {r.status_code}, sin filas. Body: {r.text[:200]}")
            resultados["screener"] = False
    except Exception as e:
        print(f"FAIL - {e}")
        resultados["screener"] = False

    # ------------------------------------------------ 2) lt.morningstar.com
    paso(2, "API lt.morningstar.com (snapshot)")
    try:
        if not sec_id:
            print("SKIP - sin SecId del paso 1")
            resultados["lt"] = None
        else:
            r = requests.get(
                f"https://lt.morningstar.com/api/rest.svc/klr5zyak8x/"
                f"security_details/{sec_id}",
                params={"viewId": "MFsnapshot", "currencyId": "EUR",
                        "itype": "msid", "languageId": "es-ES",
                        "responseViewFormat": "json"},
                headers={"User-Agent": UA}, timeout=25)
            ok = r.ok and r.text.strip().startswith(("[", "{"))
            print(("PASS - " + r.text[:300]) if ok
                  else f"FAIL - HTTP {r.status_code}: {r.text[:200]}")
            resultados["lt"] = ok
    except Exception as e:
        print(f"FAIL - {e}")
        resultados["lt"] = False

    # ------------------------------------------------------- 3) mstarpy
    paso(3, "mstarpy (sal-service, la fuente principal de FondosDB)")
    try:
        import mstarpy
        print(f"mstarpy {getattr(mstarpy, '__version__', '?')} instalada. "
              f"Buscando {ISIN_PRUEBA}... (puede abrir Chrome unos segundos)")
        f = mstarpy.Funds(ISIN_PRUEBA, language="es")
        print(f"  encontrado: {f.name} (secId {f.code})")
        for bloque, llamada in [
                ("quote", lambda: f.quote()),
                ("trailingReturn", lambda: f.trailingReturn("monthly")),
                ("riskVolatility", lambda: f.riskVolatility())]:
            try:
                payload = llamada()
                texto = json.dumps(payload, ensure_ascii=False)
                print(f"  {bloque:<16} PASS  ({len(texto)} bytes) "
                      f"{texto[:120]}...")
            except Exception as e:
                print(f"  {bloque:<16} FAIL  {e}")
        resultados["mstarpy"] = True
    except ImportError:
        print("FAIL - mstarpy no instalada:  pip install mstarpy")
        resultados["mstarpy"] = False
    except Exception as e:
        print(f"FAIL - {e}")
        print('  Si es un 401: sube la espera con  $env:SELENIUM_DRIVER_WAIT_TIME="20"')
        print("  Si no tienes Chrome:  pip install \"mstarpy<10\"")
        resultados["mstarpy"] = False

    # --------------------------------------- 4) sal-service directo (apikey)
    paso(4, "sal-service directo con apikey publica (3 sondas)")
    APIKEY = "lstzFDEOhfFNMLikKa0am9mgEKLBl49T"
    cab = {"User-Agent": UA, "apikey": APIKEY,
           "Referer": "https://global.morningstar.com/",
           "Origin": "https://global.morningstar.com"}
    par = {"clientId": "MDC", "version": "4.71.0"}
    resultados["sal_fondo"] = resultados["sal_etf"] = False

    # 4a) fondo tradicional con id F... (Bestinfond)
    try:
        r = requests.get("https://api-global.morningstar.com/sal-service/v1/"
                         "fund/quote/v7/F0GBR04PSV/data",
                         params=par, headers=cab, timeout=25)
        ok = r.ok and r.text.strip().startswith(("{", "["))
        print(("4a FONDO (F0GBR04PSV)  PASS - " + r.text[:250]) if ok
              else f"4a FONDO (F0GBR04PSV)  FAIL - HTTP {r.status_code}: {r.text[:150]}")
        resultados["sal_fondo"] = ok
    except Exception as e:
        print(f"4a FONDO  FAIL - {e}")

    # 4b) ETF con id 0P... (iShares MSCI World) - se espera que falle
    try:
        r = requests.get("https://api-global.morningstar.com/sal-service/v1/"
                         "etf/quote/v7/0P0000LZYG/data",
                         params=par, headers=cab, timeout=25)
        ok = r.ok and r.text.strip().startswith(("{", "["))
        print(("4b ETF (0P0000LZYG)    PASS - " + r.text[:250]) if ok
              else f"4b ETF (0P0000LZYG)    FAIL - HTTP {r.status_code}: {r.text[:150]}")
        resultados["sal_etf"] = ok
    except Exception as e:
        print(f"4b ETF  FAIL - {e}")

    # 4c) que ids alternativos expone el screener legacy (para traducir 0P -> SAL)
    try:
        r = requests.get(
            "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener",
            params={"page": 1, "pageSize": 1, "outputType": "json", "version": 1,
                    "languageId": "es-ES", "currencyId": "EUR",
                    "securityDataPoints": "SecId|FundId|ShareClassId|"
                                          "PerformanceId|MasterPortfolioId|"
                                          "TenforeId|Universe|ExchangeId|Ticker",
                    "term": "IE00B4L5Y983"},
            headers={"User-Agent": UA, "Referer": "https://www.morningstar.es/"},
            timeout=25)
        rows = (r.json().get("rows") or []) if r.ok else []
        print("4c IDS DISPONIBLES:", json.dumps(rows[0] if rows else {},
                                                ensure_ascii=False))
    except Exception as e:
        print(f"4c IDS  FAIL - {e}")

    # -------------------------------------------------------------- veredicto
    print(f"\n{'='*60}\nVEREDICTO: {resultados}")
    if resultados.get("sal_fondo"):
        print("=> sal-service acepta ids F... : los ~20 bloques completos")
        print("   funcionaran para FONDOS tradicionales (espanoles/europeos).")
        if not resultados.get("sal_etf"):
            print("   Para ETFs el id 0P... no vale; los ETFs ya van sobrados")
            print("   con lt+justETF (~370 campos).")
    elif resultados.get("mstarpy"):
        print("=> Morningstar via mstarpy operativa. Ejecuta: python main.py update --all")
    elif resultados.get("screener") or resultados.get("lt"):
        print("=> Las APIs sin sesion (screener+lt) responden: morningstar_lt")
        print("   funciona en modo basico. sal-service bloqueado.")
    else:
        print("=> Nada responde: revisa conexion/cortafuegos y reintenta. "
              "FondosDB seguira funcionando con justETF mientras tanto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
