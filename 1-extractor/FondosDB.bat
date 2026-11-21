@echo off
title FondosDB
cd /d "%~dp0"
echo  ==============================================
echo    FondosDB - interfaz web local
echo.
echo    El navegador se abrira solo en unos segundos.
echo    NO cierres esta ventana mientras uses la app
echo    (cerrarla detiene el servidor).
echo  ==============================================
echo.
python app.py
if errorlevel 1 (
  echo.
  echo  Ha habido un error. Revisa el mensaje de arriba.
  echo.
  pause
)
