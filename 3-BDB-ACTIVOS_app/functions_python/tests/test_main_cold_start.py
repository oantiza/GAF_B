"""Lightweight read endpoints must not initialize the dataframe engine.

Hasta el 17-11-2026 comprobaba tambien que el motor de extractos (`portfolio_real/`) no se cargaba al
arrancar; ese motor se borro (decision A-188). Lo que queda es lo que vale para todas: importar `main`
no carga pandas.
"""
from pathlib import Path
import subprocess
import sys


def test_entrypoint_defers_dataframe_engine_until_requested():
    code = "import main,sys; assert 'pandas' not in sys.modules; assert callable(main.list_portfolios)"
    completed = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=30)
    assert completed.returncode == 0, completed.stderr
