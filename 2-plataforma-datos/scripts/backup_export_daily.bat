@echo off
setlocal
set BDB_BACKUP_WRITE_STATUS_DOC=true
cd /d "%~dp0.."
npm run backup:export
if errorlevel 1 exit /b %errorlevel%
npm run backup:retention -- --write
endlocal
