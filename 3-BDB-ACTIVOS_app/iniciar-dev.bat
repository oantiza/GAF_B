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
rem Token del servicio local de operaciones (decision 6.7b, 17-10-2026): el
rem extractor lo exige y lo crea la primera vez (config\ops_token.txt).
rem Sin el, la pestana Sistema / Operaciones recibe 401.
if not defined VITE_BDB_OPS_TOKEN if exist "%~dp0..\1-extractor\main.py" (
  pushd "%~dp0..\1-extractor"
  for /f "usebackq delims=" %%t in (`python main.py ops-token 2^>nul`) do set "VITE_BDB_OPS_TOKEN=%%t"
  popd
)
if not defined VITE_BDB_OPS_TOKEN echo Aviso: no se ha obtenido el token de operaciones (python main.py ops-token en 1-extractor). Si el servicio lo exige, la pestana Sistema / Operaciones respondera 401.
echo.
call npm run dev
echo.
echo (El servidor se ha detenido.)
pause
