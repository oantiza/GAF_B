"""El catálogo de planes de pensiones y EPSV: de lo que contesta la fuente a un fichero propio.

Decisión D-11 de Óscar (13-11-2026). Un plan de pensiones o una EPSV forman parte del
patrimonio de un cliente, pero no de su cartera: no se gestionan con ella, por fiscalidad, y
por eso este catálogo va **aparte** de los instrumentos. No pasa por `update`, no escribe en
`data/funds/` ni en `export_bdb/`, y no llega al Buscador ni al optimizador. Sirve para una
cosa: ver la ficha de un plan y ponerla junto a la de otro.

**Aquí no se calcula nada.** Cada cifra es la que da la fuente, con su nombre: no hay método
propio, ni métricas nuestras, ni orden por atractivo. Lo único que se hace con los datos es:

- **decir si es un plan de pensiones o una EPSV**, que es lo que Óscar pidió marcar por
  encima de todo, porque tributan distinto. Se decide con dos señales independientes que
  tienen que coincidir: un plan de pensiones está registrado en la DGSFP y trae su código
  (`N1981`); una EPSV es de ley vasca, no lo tiene, y lleva «EPSV» en el nombre. El
  13-11-2026 coincidían en los 220: 202 con código y 18 sin él, que eran las 18 EPSV. Si
  las dos señales se contradicen, el producto **no entra** y se nombra en `sin_clasificar`:
  no se adivina;
- **reducir la serie diaria a un valor por mes**, el último de cada mes, para el gráfico de
  evolución de la ficha. No es una media ni un cálculo: es elegir qué puntos se guardan. El
  último punto de la serie se conserva siempre, aunque el mes no haya acabado.

La salida es `export_planes/planes.json`, que no va al repositorio: los datos son de
Morningstar. La lee la plataforma (`2-plataforma-datos`), que es quien la valida contra su
contrato y la escribe en la base.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from pathlib import Path

log = logging.getLogger("fondosdb.planes")

RUTA_SALIDA = Path("export_planes") / "planes.json"
ESQUEMA = "fondosdb.planes.v1"
DECISION = "D-11 de DECISIONES_ADQUISICION_2026-10-30 (Oscar, 13-11-2026)"

PLAN = "PLAN_DE_PENSIONES"
EPSV = "EPSV"

RE_DGSFP = re.compile(r"^N\d{4}$")
RE_SEC_ID = re.compile(r"^[A-Z0-9]{10}$")
RE_EPSV = re.compile(r"\bEPSV\b", re.IGNORECASE)
#: Plan de pensiones de empleo simplificado: sigue siendo un plan de pensiones, de otra modalidad.
RE_PPES = re.compile(r"\bPPES\b", re.IGNORECASE)


def _texto(valor) -> str | None:
    return valor.strip() if isinstance(valor, str) and valor.strip() else None


def _numero(valor) -> float | None:
    """Un número finito, venga como número o como texto («1.5»). Lo demás, nada."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        numero = float(valor)
    elif isinstance(valor, str):
        try:
            numero = float(valor.strip())
        except ValueError:
            return None
    else:
        return None
    return numero if numero == numero and abs(numero) != float("inf") else None


def _fecha(valor) -> str | None:
    """`AAAA-MM-DD` de lo que la fuente dé como fecha, con hora o sin ella."""
    texto = _texto(valor)
    if not texto:
        return None
    try:
        return dt.date.fromisoformat(texto[:10]).isoformat()
    except ValueError:
        return None


def tipo_de(fila: dict) -> tuple[str | None, str]:
    """(tipo, por qué). `None` si las dos señales no coinciden: no se adivina."""
    codigo = _texto(fila.get("DGSCode"))
    dice_epsv = bool(RE_EPSV.search(_texto(fila.get("Name")) or "")) or bool(RE_EPSV.search(_texto(fila.get("LegalName")) or ""))
    if codigo and not RE_DGSFP.match(codigo):
        return None, f"el código «{codigo}» no tiene forma de código de plan de la DGSFP"
    if codigo and dice_epsv:
        return None, f"lleva «EPSV» en el nombre y también código de la DGSFP ({codigo})"
    if codigo:
        return PLAN, f"registrado en la DGSFP con el código {codigo}"
    if dice_epsv:
        return EPSV, "sin código de la DGSFP y con «EPSV» en el nombre"
    return None, "sin código de la DGSFP y sin «EPSV» en el nombre"


def mensual(serie: list[tuple[dt.date, float]]) -> list[list]:
    """El último valor de cada mes, como `[fecha, valor]`, en orden. La serie llega ascendente."""
    por_mes: dict[tuple[int, int], tuple[dt.date, float]] = {}
    for dia, valor in serie:
        por_mes[(dia.year, dia.month)] = (dia, valor)
    return [[dia.isoformat(), valor] for dia, valor in (por_mes[mes] for mes in sorted(por_mes))]


def _sin_nulos(mapa: dict) -> dict:
    return {clave: valor for clave, valor in mapa.items() if valor is not None}


def ficha_de(fila: dict, tipo: str, serie: list[tuple[dt.date, float]]) -> dict:
    """Un producto, con los nombres de aquí y las cifras tal como las da la fuente.

    Las rentabilidades, la volatilidad y las comisiones vienen en tanto por ciento (3,03 es un
    3,03 %); el patrimonio y el valor de la participación, en euros. Lo que la fuente no da no
    aparece: no se escribe un cero ni un nulo."""
    nombre = _texto(fila.get("Name")) or ""
    estrellas = int(_numero(fila.get("StarRatingM255"))) if _numero(fila.get("StarRatingM255")) else None
    ficha = _sin_nulos({
        "id": _texto(fila.get("SecId")),
        "nombre": nombre,
        "nombre_legal": _texto(fila.get("LegalName")),
        "tipo": tipo,
        "empleo_simplificado": True if RE_PPES.search(nombre) else None,
        "codigo_dgsfp": _texto(fila.get("DGSCode")),
        "gestora": _texto(fila.get("AdministratorCompanyName")),
        "categoria": _texto(fila.get("CategoryName")),
        "estrellas": estrellas,
        "estrellas_fecha": _fecha(fila.get("StarRatingDate")) if estrellas else None,
        "divisa": _texto(fila.get("Currency")),
        "fecha_inicio": _fecha(fila.get("InceptionDate")),
        "patrimonio": _numero(fila.get("FundTNAV")),
        "inversion_minima": _numero(fila.get("CustomMinimumPurchaseAmount")),
    })
    valor, fecha = _numero(fila.get("ClosePrice")), _fecha(fila.get("ClosePriceDate"))
    if valor is not None and fecha:
        ficha["valor_participacion"] = {"valor": valor, "fecha": fecha}
    bloques = {
        "rentabilidad": {"m1": "ReturnM1", "m6": "ReturnM6", "ytd": "ReturnM0", "a1": "ReturnM12", "a3": "ReturnM36",
                         "a5": "ReturnM60", "a10": "ReturnM120"},
        "volatilidad": {"a1": "StandardDeviationM12", "a3": "StandardDeviationM36"},
        "ratios": {"sharpe_a3": "SharpeM36", "alfa_a3": "AlphaM36", "beta_a3": "BetaM36", "r2_a3": "R2M36",
                   "informacion_a3": "InformationRatioM36"},
        # La del banco, que es la de la ficha que entrega. Por qué no la del proveedor ni los gastos
        # corrientes, en `fetchers/morningstar_planes.py`.
        "comisiones": {"gestion": "CustomManagementFee"},
    }
    for bloque, campos in bloques.items():
        valores = _sin_nulos({clave: _numero(fila.get(campo)) for clave, campo in campos.items()})
        if valores:
            ficha[bloque] = valores
    # La fecha de las rentabilidades es suya y no la del último valor: puede ir meses por detrás.
    fecha_rentabilidad = _fecha(fila.get("TrailingDate"))
    if fecha_rentabilidad and "rentabilidad" in ficha:
        ficha["rentabilidad_fecha"] = fecha_rentabilidad
    if serie:
        ficha["serie_mensual"] = mensual(serie)
        ficha["serie"] = {"desde": serie[0][0].isoformat(), "hasta": serie[-1][0].isoformat(), "puntos_diarios": len(serie)}
    return ficha


def compone(filas: list[dict], series: dict[str, list[tuple[dt.date, float]]], *, total_declarado: int | None,
            consultado: str | None, sin_serie: dict[str, str] | None = None) -> dict:
    """La salida entera, sin leer ni escribir nada. `series` va por identificador de la fuente."""
    from fetchers import morningstar_planes as fuente

    planes, sin_clasificar, sin_identidad = [], [], []
    vistos: set[str] = set()
    for fila in filas:
        sec_id, nombre = _texto(fila.get("SecId")), _texto(fila.get("Name"))
        if not sec_id or not RE_SEC_ID.match(sec_id) or not nombre:
            sin_identidad.append({"id": sec_id, "nombre": nombre, "motivo": "sin identificador de la fuente o sin nombre"})
            continue
        if sec_id in vistos:
            continue
        vistos.add(sec_id)
        tipo, motivo = tipo_de(fila)
        if tipo is None:
            sin_clasificar.append({"id": sec_id, "nombre": nombre, "motivo": motivo})
            continue
        planes.append(ficha_de(fila, tipo, series.get(sec_id, [])))
    planes.sort(key=lambda p: (p["nombre"].casefold(), p["id"]))
    sin_serie = sin_serie or {}
    return {
        "schema_version": ESQUEMA,
        "decision": DECISION,
        "fuente": _sin_nulos({
            "nombre": "Morningstar",
            "via": "buscador de planes de Inversis para Andbank",
            "pagina": fuente.PAGINA,
            "cliente": fuente.CLIENTE,
            "universo": fuente.UNIVERSO,
            "campos": fuente.CAMPOS.split("|"),
            "consultado": consultado,
            "uso": "interno, para el prototipo: los datos son de Morningstar y no se pueden redistribuir",
        }),
        "unidades": {"rentabilidad": "tanto por ciento; a 3, 5 y 10 años, anualizada", "volatilidad": "tanto por ciento anual",
                     "ratios": "sharpe, beta y ratio de información, sin unidad; alfa y R2, en tanto por ciento",
                     "comisiones": "tanto por ciento anual", "patrimonio": "euros", "valor_participacion": "euros",
                     "serie_mensual": "el último valor de la participación de cada mes, en euros"},
        "cuentas": {
            "declarados_por_la_fuente": total_declarado,
            "recibidos": len(filas),
            "planes": len(planes),
            "planes_de_pensiones": sum(1 for p in planes if p["tipo"] == PLAN),
            "epsv": sum(1 for p in planes if p["tipo"] == EPSV),
            "de_empleo_simplificados": sum(1 for p in planes if p.get("empleo_simplificado")),
            "con_serie": sum(1 for p in planes if p.get("serie_mensual")),
            "sin_serie": sum(1 for p in planes if not p.get("serie_mensual")),
            "sin_clasificar": len(sin_clasificar),
            "sin_identidad": len(sin_identidad),
        },
        "planes": planes,
        "sin_clasificar": sin_clasificar,
        "sin_identidad": sin_identidad,
        "sin_serie": [{"id": p["id"], "nombre": p["nombre"], "motivo": sin_serie.get(p["id"], "la fuente no da serie")}
                      for p in planes if not p.get("serie_mensual")],
    }


def con_serie_en_el_fichero(base: Path) -> int:
    """Cuántos productos tienen serie en el `planes.json` que ya hay; 0 si no lo hay o no se lee."""
    try:
        anterior = json.loads((Path(base) / RUTA_SALIDA).read_text(encoding="utf-8"))
        return sum(1 for p in anterior.get("planes") or [] if p.get("serie_mensual"))
    except (OSError, ValueError, AttributeError, TypeError):
        return 0


def pasada(base: Path, http, *, force: bool = False, con_series: bool = True, hoy: str) -> dict:
    """Pregunta la lista y, de cada producto que entra, su serie; escribe `export_planes/planes.json`.

    Si la lista no llega entera, no se escribe nada: lanza `ConnectionError`. Una serie que
    no llega no tumba la pasada: el producto entra sin gráfico y se nombra en `sin_serie`.

    Pero si no llega NINGUNA y el fichero que hay tiene series, tampoco se escribe (EXT-12, auditoría
    del 16-11-2026): eso no es que un plan no tenga gráfico, es que la fuente de las series no
    contesta, y sobrescribir dejaba el catálogo entero sin evolución hasta la pasada siguiente."""
    from core.package_integrity import atomic_write_text
    from fetchers import morningstar_planes as fuente

    filas, total, marca = fuente.lista(http, force=force)
    if total is not None and len(filas) < total:
        raise ConnectionError(f"la lista de planes llega a medias: {len(filas)} de {total}")
    series: dict[str, list[tuple[dt.date, float]]] = {}
    sin_serie: dict[str, str] = {}
    if con_series:
        candidatos = [f for f in filas if _texto(f.get("SecId")) and tipo_de(f)[0] is not None]
        for n, fila in enumerate(candidatos, start=1):
            sec_id = fila["SecId"].strip()
            try:
                serie, _ = fuente.serie(sec_id, http, force=force)
            except ConnectionError as e:
                serie, sin_serie[sec_id] = [], f"la serie no contesta: {e}"
            if serie:
                series[sec_id] = serie
            if n % 25 == 0:
                log.info("series de planes: %s de %s", n, len(candidatos))
        anteriores = con_serie_en_el_fichero(base)
        if candidatos and not series and anteriores:
            raise ConnectionError(f"no ha llegado ninguna de las {len(candidatos)} series de planes y el fichero que hay "
                                  f"tiene {anteriores}: no se sobrescribe")
    else:
        sin_serie = {str(f.get("SecId")).strip(): "la pasada se lanzó sin series" for f in filas if _texto(f.get("SecId"))}
    consultado = dt.datetime.fromtimestamp(marca, dt.timezone.utc).isoformat(timespec="seconds") if marca else None
    salida = compone(filas, series, total_declarado=total, consultado=consultado, sin_serie=sin_serie)
    salida["generado"] = hoy
    atomic_write_text(Path(base) / RUTA_SALIDA, json.dumps(salida, ensure_ascii=False, indent=1) + "\n")
    return salida
