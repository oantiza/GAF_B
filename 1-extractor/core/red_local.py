"""Si una petición a una interfaz local viene de este equipo.

Lo comparten `app.py` (127.0.0.1:8765) y `ops_server.py` (127.0.0.1:8766): los
dos escuchan solo en loopback y además exigen el `Host` (y, en `app.py`, el
`Origin`) de su propia dirección, para que una página ajena no los use por DNS
rebinding (auditoría 16-10, CRIT-07 y ALTA-15).
"""
from __future__ import annotations

NOMBRES_LOCALES = ("127.0.0.1", "localhost")


def autoridades_locales(puerto: int) -> set[str]:
    """Los `host[:puerto]` con que un navegador llega a este servidor.

    Con el puerto por defecto de HTTP (80) el navegador no lo escribe ni en
    `Host` ni en `Origin`: `127.0.0.1` a secas también vale (revisión de la
    rama, MEN-3)."""
    autoridades = {f"{nombre}:{puerto}" for nombre in NOMBRES_LOCALES}
    if puerto == 80:
        autoridades.update(NOMBRES_LOCALES)
    return autoridades


def host_local(cabecera: str | None, puerto: int) -> bool:
    """La cabecera `Host` es la de este servidor."""
    return (cabecera or "").strip().lower() in autoridades_locales(puerto)


def origen_local(cabecera: str | None, puerto: int) -> bool:
    """La cabecera `Origin` es la de este mismo servidor (`http://...`)."""
    return (cabecera or "").strip().lower() in {f"http://{a}" for a in autoridades_locales(puerto)}
