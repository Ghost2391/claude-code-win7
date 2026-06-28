@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem Claude Code Win7 Launcher
rem Uses portable Node.js v18.20.8 for Windows 7 compatibility
rem All config files (settings, plugins, MCP, etc.) are stored
rem in the claude installation directory, not in C:\Users.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

rem Allow override via CLAUDE_CODE_NODE_PATH environment variable
if not defined CLAUDE_CODE_NODE_PATH (
    set "CLAUDE_CODE_NODE_PATH=%PROJECT_ROOT%\node-v18.20.8-win-x64\node.exe"
)

rem Check if portable Node.js exists
if not exist "%CLAUDE_CODE_NODE_PATH%" (
    echo [ERROR] Node.js not found at: %CLAUDE_CODE_NODE_PATH%
    echo.
    echo Please either:
    echo   1. Set CLAUDE_CODE_NODE_PATH environment variable to your node.exe
    echo   2. Place portable Node.js v18.20.8 at the expected path
    echo.
    pause
    exit /b 1
)

rem Store all config in claude installation directory (not C:\Users)
rem Cloud desktop environments may wipe C:\Users on reboot
if not defined CLAUDE_CONFIG_DIR (
    rem Resolve PROJECT_ROOT to an absolute path (%~dp0.. → drive:\parent)
    for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT_ABS=%%~fI"
    rem Auto-create .claude config directory if it doesn't exist
    if not exist "%PROJECT_ROOT_ABS%\.claude" mkdir "%PROJECT_ROOT_ABS%\.claude" 2>nul
    set "CLAUDE_CONFIG_DIR=%PROJECT_ROOT_ABS%\.claude"
)

rem Set Windows 7 compatible Node.js options
set "NODE_OPTIONS=--no-warnings %NODE_OPTIONS%"

rem Node.js 18 blocks Win7 by default; skip the platform check
set "NODE_SKIP_PLATFORM_CHECK=1"

rem Launch Claude Code
"%CLAUDE_CODE_NODE_PATH%" "%SCRIPT_DIR%cli-node.js" %*
