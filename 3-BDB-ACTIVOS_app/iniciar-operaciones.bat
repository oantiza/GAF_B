@echo off
title BDB-ACTIVOS - servicio local de operaciones
cd /d "%~dp0..\1-extractor"
echo ============================================================
echo   BDB-ACTIVOS  -  servicio local de operaciones
echo ============================================================
echo.
echo Arranca el servicio del extractor (python main.py ops) en
echo http://127.0.0.1:8766 para la pestana Sistema / Operaciones
echo de la app: alta, extraccion, canonico, correcciones y la
echo plataforma de datos (copia, pasada en seco, escritura).
echo.
echo Solo atiende a la app en esta maquina. NO cierres esta ventana
echo mientras uses la pestana (cerrarla detiene el servicio).
echo Para parar el servicio: pulsa Ctrl+C.
echo ============================================================
echo.
python main.py ops
if errorlevel 1 (
  echo.
  echo  Ha habido un error. Revisa el mensaje de arriba.
  echo.
  pause
)
