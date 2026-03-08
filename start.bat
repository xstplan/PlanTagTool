@echo off
chcp 65001 >nul
echo ==========================================
echo   LoRA Dataset Label Tool
echo ==========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist ".venv" (
    echo [INFO] Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo [INFO] Installing dependencies...
pip install -r requirements.txt -q

echo.
echo [INFO] Starting server at http://localhost:8701
echo [INFO] Press Ctrl+C to stop
echo.
start "" "http://localhost:8701"
python -m uvicorn scripts.server:app --host 0.0.0.0 --port 8701 --reload

pause
