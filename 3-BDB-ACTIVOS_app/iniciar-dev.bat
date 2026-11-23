@echo off
title BDB-ACTIVOS - servidor de desarrollo
cd /d "%~dp0"
echo ============================================================
echo   BDB-ACTIVOS  -  servidor de desarrollo (Vite)
echo ============================================================
echo.
echo Arrancando... cuando veas:  Local: http://localhost:5173/
echo abrelo en el navegador (Ctrl+clic o copia la URL).
echo.
echo Para parar el servidor: pulsa Ctrl+C en esta ventana.
echo ============================================================
echo.
call npm run dev
echo.
echo (El servidor se ha detenido.)
pause
