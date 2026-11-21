"""Correcciones manuales de campos sueltos, en origen.

Cuando una fuente trae un dato mal (un SRI leído de un KID viejo, un domicilio
equivocado, una gestora legal con el nombre del comercializador), lo que se
quiere es corregir **ese** campo y que la corrección sobreviva a la siguiente
pasada del extractor y llegue a la maestra por el mismo camino que todo lo
demás (canónico → pasada en seco → escritura). Editar el canónico o la maestra
a mano rompería eso a la primera regeneración.

Por eso las correcciones viven en `config/correcciones.json` (ISIN → ruta del
esquema v2 → {valor, motivo, autor, fecha}) y se aplican en el núcleo de
adquisición, justo después de fusionar las fuentes y antes del saneado
(limpieza, derivados, calidad), de modo que lo derivado se calcula ya con el
dato corregido. La procedencia del campo pasa a ser `manual:<autor>`, que se
ve en la ficha v2 (`meta.procedencia`, `meta.correcciones`) y en el canónico
(`provenance.fields`). `manual` no cuenta como fuente oficial.

Reglas:
- Solo valores escalares (texto, número, booleano) o `null`, que borra el campo.
- La ruta tiene que estar declarada por algún adaptador (`capacidades`): no se
  inventan campos que el esquema no conoce.
- `motivo` obligatorio: una corrección sin porqué no se puede auditar.
- Si la fuente ya trae el mismo valor, la corrección se marca `redundante` y
  la procedencia se queda con la fuente: la corrección puede retirarse.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

from core.adquisicion import capacidades, procedencia
from core.package_integrity import atomic_write_text, bloqueo_config, lee_bytes

FICHERO = Path("config") / "correcciones.json"
VERSION = 1
FUENTE = "manual"
ESCALARES = (str, int, float, bool)
RE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
RE_RUTA = re.compile(r"^[a-z0-9_]+(\.[A-Za-z0-9_\- ]+)+$")
RE_AUTOR = re.compile(r"[^a-z0-9_\-]+")


class ErrorCorreccion(ValueError):
    pass


# ------------------------------------------------------------------ fichero
def carga(base: Path) -> dict[str, dict[str, dict]]:
    """ISIN -> ruta -> corrección. Fichero ausente = sin correcciones."""
    ruta = Path(base) / FICHERO
    if not ruta.exists():
        return {}
    try:
        datos = json.loads(lee_bytes(ruta).decode("utf-8"))   # con reintentos (IMP-1)
    except ValueError as e:
        raise ErrorCorreccion(f"{FICHERO} no es JSON válido: {e}") from e
    cuerpo = datos.get("correcciones") if isinstance(datos, dict) else None
    return cuerpo if isinstance(cuerpo, dict) else {}


def guarda(base: Path, correcciones: dict[str, dict[str, dict]]) -> Path:
    ruta = Path(base) / FICHERO
    ruta.parent.mkdir(parents=True, exist_ok=True)
    limpio = {isin: dict(sorted(rutas.items())) for isin, rutas in sorted(correcciones.items()) if rutas}
    atomic_write_text(ruta, json.dumps({"version": VERSION, "correcciones": limpio}, ensure_ascii=False, indent=2) + "\n")
    return ruta


def lista(base: Path, isin: str | None = None) -> list[dict]:
    """Filas planas {isin, ruta, valor, motivo, autor, fecha}, ordenadas."""
    todas = carga(base)
    filas = []
    for i, rutas in sorted(todas.items()):
        if isin and i != isin.strip().upper():
            continue
        for ruta, c in sorted(rutas.items()):
            filas.append({"isin": i, "ruta": ruta, **c})
    return filas


def autor_por_defecto(settings: dict | None = None) -> str:
    return sanea_autor((settings or {}).get("autor") or os.environ.get("USERNAME") or os.environ.get("USER") or FUENTE)


def sanea_autor(autor: str) -> str:
    """`Óscar A.` -> `oscar-a`: la etiqueta `manual:<autor>` no admite `:` ni `+`."""
    plano = unicodedata.normalize("NFKD", str(autor or "")).encode("ascii", "ignore").decode("ascii")
    limpio = RE_AUTOR.sub("-", plano.strip().lower()).strip("-")
    return limpio or FUENTE


def etiqueta(autor: str) -> str:
    return procedencia.etiqueta(FUENTE, sanea_autor(autor))


# -------------------------------------------------------------- validación
def rutas_declaradas(adaptadores) -> dict[str, list[str]]:
    """Patrón declarado -> adaptadores que lo declaran (para saber qué se puede corregir)."""
    out: dict[str, list[str]] = {}
    for a in adaptadores:
        for patron in a.capacidades:
            out.setdefault(patron, []).append(a.id)
    return dict(sorted(out.items()))


def valida_ruta(ruta: str, adaptadores) -> str:
    """Devuelve el patrón que ampara la ruta; ErrorCorreccion si nadie la declara."""
    ruta = str(ruta or "").strip()
    if not RE_RUTA.match(ruta):
        raise ErrorCorreccion(f"ruta no válida: «{ruta}» (bloque.campo, p.ej. riesgo.sri_kid_1a7)")
    if ruta.startswith("meta.") or ruta.startswith("calidad."):
        raise ErrorCorreccion(f"«{ruta}» no se corrige a mano: lo calcula el extractor")
    for a in adaptadores:
        patron = capacidades.cubre(a.capacidades, ruta)
        if patron:
            return patron
    raise ErrorCorreccion(f"ningún adaptador declara la ruta «{ruta}»: no es un campo del esquema")


def interpreta_valor(texto: str) -> Any:
    """Del CLI llega texto: null, true/false, número o texto tal cual."""
    t = str(texto).strip()
    bajo = t.lower()
    if bajo in ("null", "none", "nulo", ""):
        return None
    if bajo in ("true", "verdadero", "si", "sí"):
        return True
    if bajo in ("false", "falso", "no"):
        return False
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t.replace(",", "."))
    except ValueError:
        return t


def valida_valor(valor: Any) -> Any:
    if valor is None or isinstance(valor, ESCALARES):
        return valor
    raise ErrorCorreccion(f"solo se corrigen valores escalares (texto, número, booleano) o null; llegó {type(valor).__name__}")


def acomoda_valor(valor: Any, actual: Any) -> Any:
    """Ajusta el tipo al del dato que ya hay: un SRI es entero, un TER es número,
    un UCITS es booleano. Un texto donde hay número es un error, no un cambio de tipo."""
    if valor is None or actual is None:
        return valor
    if isinstance(actual, bool):
        if isinstance(valor, bool):
            return valor
        if isinstance(valor, str) and valor.strip().lower() in ("true", "false", "si", "sí", "no", "verdadero", "falso"):
            return interpreta_valor(valor)
        raise ErrorCorreccion(f"el campo es booleano y llegó {valor!r}")
    if isinstance(actual, (int, float)) and not isinstance(actual, bool):
        if isinstance(valor, bool):
            raise ErrorCorreccion(f"el campo es numérico y llegó un booleano ({valor!r})")
        if isinstance(valor, (int, float)):
            return int(valor) if isinstance(actual, int) and float(valor).is_integer() else valor
        n = interpreta_valor(valor)
        if isinstance(n, (int, float)) and not isinstance(n, bool):
            return int(n) if isinstance(actual, int) and float(n).is_integer() else n
        raise ErrorCorreccion(f"el campo es numérico y llegó {valor!r}")
    if isinstance(actual, str):
        return str(valor)
    return valor


# ------------------------------------------------------------------ altas
def pon(base: Path, isin: str, ruta: str, valor: Any, motivo: str, autor: str = "",
        adaptadores=None, actual: Any = None, nueva: bool = False) -> dict:
    """Registra (o sustituye) una corrección. Devuelve la fila guardada.

    `actual` es el valor que la ficha tiene hoy en esa ruta (None si no lo hay).
    Una ruta amparada solo por un comodín (`riesgo.*`) y ausente de la ficha
    se rechaza salvo `nueva=True`: así una errata no crea un campo fantasma."""
    isin = str(isin or "").strip().upper()
    if not RE_ISIN.match(isin):
        raise ErrorCorreccion(f"ISIN no válido: «{isin}»")
    if adaptadores is None:
        from core.adquisicion import registro
        adaptadores = registro.ADAPTADORES
    ruta = str(ruta).strip()
    patron = valida_ruta(ruta, adaptadores)
    if "*" in patron and actual is None and valor is not None and not nueva:
        raise ErrorCorreccion(
            f"«{ruta}» solo la ampara el patrón genérico «{patron}» y el activo no tiene ese campo: "
            "si de verdad es un campo nuevo, repite indicando que es nuevo (--nueva)")
    motivo = " ".join(str(motivo or "").split())
    if len(motivo) < 3:
        raise ErrorCorreccion("hace falta un motivo (por qué se corrige y de dónde sale el dato)")
    valor = acomoda_valor(valida_valor(valor), actual)
    fila = {"valor": valor, "motivo": motivo, "autor": sanea_autor(autor or autor_por_defecto()),
            "fecha": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
    # Leer y reescribir el fichero entero bajo el bloqueo de config/: dos
    # correcciones a la vez (peticiones del servicio en hilos distintos) no
    # deben perder una (MEDIA-8).
    with bloqueo_config(base):
        todas = carga(base)
        todas.setdefault(isin, {})[ruta] = fila
        guarda(base, todas)
    return {"isin": isin, "ruta": ruta, **fila}


def quita(base: Path, isin: str, ruta: str) -> bool:
    isin = str(isin or "").strip().upper()
    with bloqueo_config(base):  # ver `pon`
        todas = carga(base)
        if ruta not in (todas.get(isin) or {}):
            return False
        del todas[isin][ruta]
        if not todas[isin]:
            del todas[isin]
        guarda(base, todas)
    return True


# --------------------------------------------------------------- aplicación
def aplica(final: dict, isin: str, base: Path, proc: dict[str, str]) -> dict[str, dict]:
    """Aplica al v2 fusionado las correcciones del ISIN y devuelve `meta.correcciones`.

    Se llama desde el núcleo, con `proc` = meta.procedencia (se actualiza aquí).
    Cada entrada dice qué había (`valor_fuente`, `fuente`) y si la corrección
    fue `redundante` (la fuente ya coincidía) para poder retirarla.
    """
    try:
        rutas = carga(base).get(str(isin).strip().upper()) or {}
    except ErrorCorreccion as e:
        final.setdefault("meta", {}).setdefault("errores", []).append(f"correcciones: {e}")
        return {}
    if not rutas:
        return {}
    from core.schema import _get_path, set_path
    aplicadas: dict[str, dict] = {}
    for ruta, c in sorted(rutas.items()):
        valor = c.get("valor")
        anterior = _get_path(final, ruta)
        if isinstance(anterior, dict):
            final.setdefault("meta", {}).setdefault("errores", []).append(
                f"correcciones: «{ruta}» es un bloque, no un campo; no se aplica")
            continue
        registro = {"valor": valor, "motivo": c.get("motivo"), "autor": c.get("autor"), "fecha": c.get("fecha"),
                    "valor_fuente": anterior, "fuente": proc.get(ruta), "redundante": False}
        if anterior is not None and anterior == valor and type(anterior) is type(valor):
            registro["redundante"] = True     # la fuente ya lo trae bien: la procedencia sigue siendo suya
        elif valor is None:
            _borra(final, ruta)
            proc.pop(ruta, None)
        else:
            set_path(final, ruta, valor)
            proc[ruta] = etiqueta(c.get("autor") or FUENTE)
        aplicadas[ruta] = registro
    return aplicadas


def _borra(d: dict, ruta: str) -> None:
    partes = ruta.split(".")
    for p in partes[:-1]:
        d = d.get(p) if isinstance(d, dict) else None
        if not isinstance(d, dict):
            return
    d.pop(partes[-1], None)


# ------------------------------------------------------------- para la app
def campos(ficha: dict | None, correcciones_isin: dict[str, dict] | None = None,
           adaptadores=None) -> list[dict]:
    """Campos corregibles de una ficha v2: hojas escalares con su valor y su
    fuente, más las correcciones registradas aunque el campo no exista aún."""
    if adaptadores is None:
        from core.adquisicion import registro
        adaptadores = registro.ADAPTADORES
    ficha = ficha or {}
    proc = (ficha.get("meta") or {}).get("procedencia") or {}
    aplicadas = (ficha.get("meta") or {}).get("correcciones") or {}
    correcciones_isin = correcciones_isin or {}
    filas: dict[str, dict] = {}
    for ruta, valor in procedencia.hojas(ficha):
        if ruta.startswith("meta.") or ruta.startswith("calidad.") or isinstance(valor, (list, dict)):
            continue
        try:
            valida_ruta(ruta, adaptadores)
        except ErrorCorreccion:
            continue
        filas[ruta] = {"ruta": ruta, "valor": valor, "fuente": proc.get(ruta),
                       "tipo": _tipo(valor), "correccion": None, "aplicada": None}
    for ruta, c in correcciones_isin.items():
        fila = filas.setdefault(ruta, {"ruta": ruta, "valor": None, "fuente": None, "tipo": _tipo(c.get("valor")),
                                       "correccion": None, "aplicada": None})
        fila["correccion"] = c
        fila["aplicada"] = aplicadas.get(ruta)
    return [filas[r] for r in sorted(filas)]


def _tipo(valor: Any) -> str:
    if isinstance(valor, bool):
        return "booleano"
    if isinstance(valor, (int, float)):
        return "numero"
    if valor is None:
        return "vacio"
    return "texto"
