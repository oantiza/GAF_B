"""Planes de pensiones y EPSV: la lista y la serie, del buscador de planes que enseña el banco.

No son instrumentos de cartera y no pasan por `update`: no tienen ISIN, no entran en
`config/fondos.csv` ni en `export_bdb/`. Es un catálogo aparte (decisión D-11 de Óscar,
13-11-2026, en `DECISIONES_ADQUISICION_2026-10-30.md`), que solo sirve para ver la ficha
de un plan y ponerla junto a la de otro. Quien decide qué se hace con lo leído es
`core/planes.py`; esto solo pregunta.

**De dónde sale.** Del buscador de planes de Inversis para Andbank, que es una herramienta
de Morningstar alojada en `lt.morningstar.com` con su propio cliente (`CLIENTE`) y su
propio universo (`UNIVERSO`): los planes y las EPSV que el banco comercializa, 220 el
13-11-2026. Es el mismo servidor que ya usa `morningstar_lt` para los fondos y la misma
clase de acceso: una API interna, sin contrato ni documentación, que puede cambiar o
cortarse sin aviso. Los datos son de Morningstar y no se pueden redistribuir: valen para
este prototipo, de uso interno, y nada más.

**Por qué el cliente del banco y no el del extractor** (medido el 13-11-2026): con el
cliente de los fondos el universo de planes existe (`FOESP$$PEN`, 834), pero le faltan 3
de los 220, no trae la comisión de gestión (`CustomManagementFee` es un campo que pone el
banco) y su serie solo responde con un sufijo en el identificador. Con el del banco la
selección es la que Óscar pidió, sin tener que copiarla.

**Lo que no se pide**, y por qué (medido el 13-11-2026 sobre los 220):

- El percentil dentro de la categoría (`CatRankM12`, `CatRankM36`): la decisión D3 lo dejó
  fuera para los fondos, y aquí se sigue el mismo límite.
- Los gastos corrientes (`OngoingCharge`): los da en 132, con fecha propia que llega a ser de
  2021, y en 22 de esos 132 son MENORES que la comisión de gestión del mismo proveedor, que
  es imposible por definición. Una cifra así no se enseña.
- La comisión de gestión del proveedor (`ManagementFee`): la da en los 220, pero en 41 de los
  155 en que también está la del banco no coinciden, y nada aquí dice cuál vale. Se guarda una
  sola, la del banco (`CustomManagementFee`), que es la que sale en la ficha que el banco
  entrega; donde el banco no la pone, falta. La vigente es la del documento de datos
  fundamentales de cada plan.
- El indicador de riesgo (`SRRI`): no consta que salga del documento del plan, y un indicador
  de riesgo que no sale de su documento no se escribe como si lo fuera (decisión 43).

**Las fechas sí se piden.** `TrailingDate` es la fecha de las rentabilidades y no siempre es
la del último valor: en 4 de los 220 iba meses por detrás. `StarRatingDate`, la de las
estrellas. La volatilidad y los ratios no traen fecha.
"""
from __future__ import annotations

import logging

from fetchers import morningstar_series

log = logging.getLogger("fondosdb.morningstar_planes")

CLIENTE = "ti0skfyxp8"
UNIVERSO = "FOESP$$PEN_4200"
BUSCADOR = f"https://lt.morningstar.com/api/rest.svc/{CLIENTE}/security/screener"
SERIE = f"https://lt.morningstar.com/api/rest.svc/timeseries_price/{CLIENTE}"
PAGINA = "https://lt.morningstar.com/ti0skfyxp8/custom/simplepage1/default.aspx"
DIVISA = "EUR"
POR_PAGINA = 100
#: Tope de páginas: con 220 productos son tres. Si la fuente declarase un total disparatado,
#: la pasada no se queda pidiendo sin fin.
MAX_PAGINAS = 30

#: Lo que se pide de cada producto, en el orden de las pestañas del buscador del banco.
CAMPOS = ("SecId|Name|LegalName|DGSCode|AdministratorCompanyName|CategoryName|StarRatingM255|StarRatingDate|Currency|"
          "InceptionDate|ClosePrice|ClosePriceDate|FundTNAV|"
          "TrailingDate|ReturnM1|ReturnM6|ReturnM0|ReturnM12|ReturnM36|ReturnM60|ReturnM120|"
          "StandardDeviationM12|StandardDeviationM36|SharpeM36|AlphaM36|BetaM36|R2M36|InformationRatioM36|"
          "CustomManagementFee|CustomMinimumPurchaseAmount")


def _parametros(pagina: int) -> dict[str, str | int]:
    return {"page": pagina, "pageSize": POR_PAGINA, "sortOrder": "Name asc", "outputType": "json",
            "version": 1, "languageId": "es-ES", "currencyId": DIVISA, "universeIds": UNIVERSO,
            "securityDataPoints": CAMPOS}


def lista(http, force: bool = False) -> tuple[list[dict], int | None, float | None]:
    """(filas, total que declara la fuente, fetched_at de la primera página).

    Lanza `ConnectionError` si una página no contesta o no es lo que se espera: una lista a
    medias no es una lista, y quien llama no debe escribir un catálogo con ella."""
    filas: list[dict] = []
    total: int | None = None
    consultado: float | None = None
    for pagina in range(1, MAX_PAGINAS + 1):
        r = http.get(BUSCADOR, params=_parametros(pagina), headers={"Referer": PAGINA}, force=force,
                     familia="rendimiento")
        if not getattr(r, "ok", False):
            raise ConnectionError(f"el buscador de planes no contesta (página {pagina}, status={getattr(r, 'status', '?')})")
        try:
            cuerpo = r.json()
        except ValueError as e:
            raise ConnectionError(f"el buscador de planes no devuelve JSON (página {pagina})") from e
        if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("rows"), list):
            raise ConnectionError(f"el buscador de planes devuelve otra forma (página {pagina})")
        if pagina == 1:
            total = cuerpo.get("total") if isinstance(cuerpo.get("total"), int) else None
            consultado = getattr(r, "fetched_at", None)
        filas.extend(f for f in cuerpo["rows"] if isinstance(f, dict))
        if not cuerpo["rows"] or (total is not None and len(filas) >= total):
            break
    return filas, total, consultado


def serie(sec_id: str, http, force: bool = False):
    """(serie diaria ascendente, fetched_at) del valor de la participación, o ([], None).

    Misma petición y mismo lector que la serie de respaldo de los fondos; cambia el cliente.
    No captura `ConnectionError`: quien llama decide qué significa que no conteste."""
    r = http.get(SERIE, params=morningstar_series.parametros(sec_id, DIVISA), headers={"Referer": PAGINA},
                 force=force, familia="precio")
    if not getattr(r, "ok", False):
        log.info("serie del plan %s sin respuesta (status=%s)", sec_id, getattr(r, "status", "?"))
        return [], None
    try:
        crudo = r.json()
    except ValueError:
        log.info("serie del plan %s: la respuesta no es JSON", sec_id)
        return [], None
    return morningstar_series.lee(crudo), getattr(r, "fetched_at", None)
