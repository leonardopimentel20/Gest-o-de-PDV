@echo off
cd /d "%~dp0"
node scripts\backup-banco.js
if errorlevel 1 (
    echo O backup NAO foi concluido. Confira a mensagem acima.
) else (
    echo Backup concluido na pasta BACKUP_DIR configurada no .env.
)
pause
