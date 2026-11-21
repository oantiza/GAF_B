# -*- coding: utf-8 -*-
"""Emisores de las acciones por LEI: «un LEI, un emisor».

Decisión 8 de `DECISIONES_DATOS_2026-11-07.md`, aprobada por Óscar el 07-11-2026. El contrato
`issuer.v2` decía que asignar un emisor era una decisión humana, y tenía razón por cómo se
habría hecho: casando nombres de texto, que es justo lo que un lote no puede decidir. Con el
LEI no hay nombres que casar. El LEI lo pone FIRDS en cada acción (`identidad_firds.lei_emisor`
del canónico), y el nombre legal, el país y el estado los pone GLEIF, que es el registro que
emite los LEI. Lo humano es la regla, y la aprobó Óscar; el lote solo la aplica.

## Las tres piezas, y dónde vive cada una

- **El registro de ids**, `config/emisores_lei.csv`: `LEI → ISS_000001`. Va en `config/`, en
  Git, porque es lo único que no se puede regenerar: el contrato pide que el id se escriba
  una vez y no se recalcule. Un LEI nuevo recibe el siguiente número, en orden de LEI dentro
  de su pasada, y un LEI que ya tiene id lo conserva para siempre, aunque desaparezca del
  universo. Nunca se reutiliza un número.
- **Lo que dice GLEIF**, en la caché HTTP (`cache/http`, familia `identidad`, 365 días). Se
  vuelve a leer sin red con `--sin-red`.
- **La salida**, `export_entidades/emisores.json`, que es lo que lee la plataforma para
  escribir `issuers/{issuer_id}` e `instrument_issuer/{isin}_EQUITY_ISSUER`. Se regenera
  entera en cada pasada, igual que `export_bdb/`.

## Qué instrumentos entran

Las acciones del canónico (`export_bdb/`, `classification_v2.asset_type == "stock"`), y su LEI
el del canónico. No el del índice FIRDS directamente, a propósito: el canónico es lo que llega a
`instruments/{isin}.identifiers.lei`, y el vínculo tiene que decir lo mismo que el instrumento.
Medido el 07-11-2026: la CAM, Ercros y CLEOP tienen LEI en el índice pero su ficha no ha pasado
por FIRDS (la guarda del nombre paró esa pasada), así que hoy quedan sin emisor, dicho, hasta que
su ficha lo traiga. Por la misma razón no entran las acciones fuera de alcance: no tienen
instrumento en la base al que enlazar.

Una acción sin LEI no tiene emisor y se cuenta por nombre. Un LEI que GLEIF no resuelve
tampoco: sin nombre legal ni país no se puede escribir la entidad, y no se inventa.

## `valid_from` del vínculo

Desde cuándo vale que ese ISIN lo emite esa entidad. No tenemos la fecha de emisión, así que
se escribe la más antigua que **prueba** que el ISIN existía: su primera negociación según
FIRDS en un centro con admisión solicitada por el emisor (la regla de la decisión 15, y por la
misma razón: un MTF que negocia el valor sin que el emisor lo pida puede traer fechas
imposibles), y si no hay ninguno, la más antigua de todos sus centros. Es un límite inferior,
no la emisión, y `reason` dice cuál de las dos se usó. El 1900-01-01 con que Fráncfort dice
«desde siempre» no cuenta (8 de las 299 acciones el 07-11-2026: Deutsche Bank, Siemens,
Allianz...): es un centinela, y se toma la fecha siguiente.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
from pathlib import Path

log = logging.getLogger("fondosdb.emisores")

RUTA_REGISTRO = Path("config") / "emisores_lei.csv"
RUTA_SALIDA = Path("export_entidades") / "emisores.json"
COLUMNAS = ("issuer_id", "lei", "alta", "regla")
REGLA = "un LEI, un emisor (decision 8 de DECISIONES_DATOS_2026-11-07, Oscar, 07-11-2026)"
DECIDIDO_POR = "Oscar (regla un LEI, un emisor, decision 8 de DECISIONES_DATOS_2026-11-07)"
DECIDIDO_EL = "2026-11-07"
ROL = "EQUITY_ISSUER"
RE_LEI = re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")
RE_ID = re.compile(r"^ISS_([0-9]{6})$")


class ErrorRegistro(ValueError):
    """`config/emisores_lei.csv` mal escrito: un id o un LEI repetido o con mala forma."""


# ------------------------------------------------------------------ registro
def lee_registro(base: Path) -> dict[str, dict]:
    """`{lei: fila}` del registro. Vacío si no existe; error si está mal escrito."""
    ruta = Path(base) / RUTA_REGISTRO
    if not ruta.exists():
        return {}
    filas: dict[str, dict] = {}
    ids: set[str] = set()
    with ruta.open(encoding="utf-8", newline="") as fh:
        for n, fila in enumerate(csv.DictReader(fh), start=2):
            lei = str(fila.get("lei") or "").strip().upper()
            iid = str(fila.get("issuer_id") or "").strip()
            if not RE_LEI.match(lei):
                raise ErrorRegistro(f"{RUTA_REGISTRO}:{n}: {lei!r} no es un LEI")
            if not RE_ID.match(iid):
                raise ErrorRegistro(f"{RUTA_REGISTRO}:{n}: {iid!r} no es un issuer_id ISS_000000")
            if lei in filas:
                raise ErrorRegistro(f"{RUTA_REGISTRO}:{n}: el LEI {lei} ya tiene id")
            if iid in ids:
                raise ErrorRegistro(f"{RUTA_REGISTRO}:{n}: el id {iid} ya es de otro LEI")
            ids.add(iid)
            filas[lei] = {"issuer_id": iid, "lei": lei, "alta": str(fila.get("alta") or ""),
                          "regla": str(fila.get("regla") or "")}
    return filas


def asigna(registro: dict[str, dict], leis: list[str], hoy: str) -> tuple[dict[str, dict], list[str]]:
    """El registro con un id para cada LEI que no lo tenga, y la lista de los nuevos.

    Los que ya tienen id no se tocan. Los nuevos, en orden de LEI, reciben el número siguiente
    al mayor que se haya usado nunca: un número no se reutiliza aunque su LEI ya no esté.
    """
    salida = {k: dict(v) for k, v in registro.items()}
    usado = max((int(RE_ID.match(v["issuer_id"]).group(1)) for v in salida.values()), default=0)
    nuevos = []
    for lei in sorted({str(x).strip().upper() for x in leis} - set(salida)):
        usado += 1
        salida[lei] = {"issuer_id": f"ISS_{usado:06d}", "lei": lei, "alta": hoy, "regla": REGLA}
        nuevos.append(lei)
    return salida, nuevos


def texto_registro(registro: dict[str, dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNAS, lineterminator="\n")
    w.writeheader()
    for fila in sorted(registro.values(), key=lambda f: f["issuer_id"]):
        w.writerow({k: fila.get(k, "") for k in COLUMNAS})
    return buf.getvalue()


def escribe_registro(base: Path, registro: dict[str, dict]) -> None:
    from core.package_integrity import atomic_write_text, bloqueo_config

    with bloqueo_config(base):
        # Se vuelve a leer dentro del bloqueo: si otro proceso añadió filas, no se pisan.
        en_disco = lee_registro(base)
        for lei, fila in en_disco.items():
            if lei in registro and registro[lei]["issuer_id"] != fila["issuer_id"]:
                raise ErrorRegistro(f"el LEI {lei} cambió de id mientras tanto "
                                    f"({fila['issuer_id']} en disco)")
        atomic_write_text(Path(base) / RUTA_REGISTRO, texto_registro({**en_disco, **registro}))


# ------------------------------------------------------------------ acciones
def _valid_from(mercados: list[dict]) -> tuple[str | None, str]:
    """La fecha más antigua que prueba que el ISIN existía, y de dónde sale.

    Sin las fechas centinela de FIRDS (`esma_firds.CENTINELA_FECHA`, el 1900-01-01 de Fráncfort):
    escribirlas en `valid_from` sería un centinela en un campo de fecha, que el contrato prohíbe.
    """
    from fetchers.esma_firds import CENTINELA_FECHA

    mercados = [m for m in mercados if str(m.get("primera_negociacion") or "") > CENTINELA_FECHA]
    con_admision = sorted(m["primera_negociacion"] for m in mercados
                          if m.get("admision") and m.get("primera_negociacion"))
    if con_admision:
        return con_admision[0], "primera negociacion en un centro con admision solicitada por el emisor"
    todas = sorted(m["primera_negociacion"] for m in mercados if m.get("primera_negociacion"))
    if todas:
        return todas[0], ("primera negociacion en cualquier centro: ninguno tiene admision "
                          "solicitada por el emisor")
    return None, "FIRDS no trae ninguna fecha de negociacion"


def acciones_del_canonico(carpeta: Path) -> list[dict]:
    """Las acciones de `export_bdb/` con lo que el vínculo necesita de cada una."""
    out = []
    for ruta in sorted(Path(carpeta).glob("*.json")):
        if ruta.name.startswith("_"):
            continue
        try:
            c = json.loads(ruta.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            log.warning("emisores: %s ilegible (%s)", ruta.name, e)
            continue
        if (c.get("classification_v2") or {}).get("asset_type") != "stock":
            continue
        firds = c.get("identidad_firds") or {}
        lei = str(firds.get("lei_emisor") or "").strip().upper() or None
        stock = (c.get("ms") or {}).get("stock") or {}
        ticker, bolsa = str(stock.get("ticker") or "").strip(), str(stock.get("exchange") or "").strip()
        desde, base_desde = _valid_from([m for m in firds.get("mercados") or [] if isinstance(m, dict)])
        out.append({
            "isin": str(c.get("isin") or ruta.stem).upper(),
            "nombre": c.get("name"),
            "lei": lei if lei and RE_LEI.match(lei) else None,
            "lei_invalido": lei if lei and not RE_LEI.match(lei) else None,
            "valid_from": desde,
            "valid_from_base": base_desde,
            "reference_listing": f"{ticker}.{bolsa}" if ticker and bolsa else None,
            "reference_currency": c.get("currency") if re.match(r"^[A-Z]{3}$", str(c.get("currency") or "")) else None,
        })
    return out


# ------------------------------------------------------------------ la pasada
def compone(acciones: list[dict], gleif: dict[str, dict], registro: dict[str, dict]) -> dict:
    """La salida entera a partir de lo ya consultado. Pura: no lee ni escribe nada.

    `gleif` es `{lei: registro_por_lei(...)}` y `registro` ya trae id para cada LEI resuelto.
    """
    emisores: dict[str, dict] = {}
    enlaces, sin_lei, sin_gleif, sin_fecha = [], [], [], []
    for a in acciones:
        if not a["lei"]:
            sin_lei.append({"isin": a["isin"], "nombre": a["nombre"],
                            "motivo": (f"el LEI del canonico no es un LEI: {a['lei_invalido']}"
                                       if a.get("lei_invalido") else "FIRDS no trae LEI en su ficha")})
            continue
        g = gleif.get(a["lei"]) or {"resuelto": False, "motivo": "no_consultado"}
        if not g.get("resuelto"):
            sin_gleif.append({"isin": a["isin"], "nombre": a["nombre"], "lei": a["lei"],
                              "motivo": g.get("motivo")})
            continue
        if not a["valid_from"]:
            sin_fecha.append({"isin": a["isin"], "nombre": a["nombre"], "lei": a["lei"],
                              "motivo": a["valid_from_base"]})
            continue
        iid = registro[a["lei"]]["issuer_id"]
        e = emisores.setdefault(iid, {
            "issuer_id": iid, "lei": a["lei"], "nombre_legal": g["nombre_legal"], "pais": g["pais"],
            "pais_origen": g.get("pais_origen"), "jurisdiccion": g.get("jurisdiccion"),
            "estado_registro": g.get("estado_registro"), "estado_entidad": g.get("estado_entidad"),
            "gleif_actualizado": g.get("gleif_actualizado"), "consultado": g.get("consultado"),
            "isins": []})
        e["isins"].append(a["isin"])
        enlaces.append({
            "isin": a["isin"], "issuer_id": iid, "role": ROL, "lei": a["lei"],
            "valid_from": a["valid_from"],
            "reference_listing": a["reference_listing"],
            "reference_currency": a["reference_currency"],
            "decided_by": DECIDIDO_POR, "decided_at": DECIDIDO_EL,
            "reason": (f"Regla un LEI, un emisor: FIRDS da a este ISIN el LEI {a['lei']}, que GLEIF "
                       f"registra como {g['nombre_legal']}. valid_from es la {a['valid_from_base']} "
                       "segun FIRDS, no la fecha de emision, que no tenemos."),
        })
    return {
        "schema_version": "fondosdb.emisores.v1",
        "regla": REGLA,
        "rol": ROL,
        "cuentas": {
            "acciones": len(acciones),
            "con_lei": sum(1 for a in acciones if a["lei"]),
            "leis_distintos": len({a["lei"] for a in acciones if a["lei"]}),
            "emisores": len(emisores),
            "enlaces": len(enlaces),
            "sin_lei": len(sin_lei),
            "lei_sin_gleif": len(sin_gleif),
            "sin_fecha": len(sin_fecha),
        },
        "emisores": sorted(emisores.values(), key=lambda e: e["issuer_id"]),
        "enlaces": sorted(enlaces, key=lambda e: e["isin"]),
        "sin_lei": sin_lei,
        "lei_sin_gleif": sin_gleif,
        "sin_fecha": sin_fecha,
    }


def pasada(base: Path, http, *, force: bool = False, hoy: str) -> dict:
    """Consulta GLEIF por cada LEI distinto, asigna ids a los nuevos y escribe la salida."""
    from fetchers import gleif as fuente_gleif
    from core.package_integrity import atomic_write_text

    base = Path(base)
    acciones = acciones_del_canonico(base / "export_bdb")
    leis = sorted({a["lei"] for a in acciones if a["lei"]})
    respuestas: dict[str, dict] = {}
    for n, lei in enumerate(leis, start=1):
        respuestas[lei] = fuente_gleif.registro_por_lei(lei, http, force=force)
        if n % 50 == 0:
            log.info("GLEIF: %s de %s LEI", n, len(leis))
    resueltos = [lei for lei, r in respuestas.items() if r.get("resuelto")]
    registro, nuevos = asigna(lee_registro(base), resueltos, hoy)
    if nuevos:
        escribe_registro(base, registro)
    salida = compone(acciones, respuestas, registro)
    salida["generado"] = hoy
    salida["cuentas"]["ids_nuevos"] = len(nuevos)
    atomic_write_text(base / RUTA_SALIDA, json.dumps(salida, ensure_ascii=False, indent=1) + "\n")
    return salida
