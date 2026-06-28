@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem Claude Code Win7 Launcher
rem Uses portable Node.js v18.20.8 for Windows 7 compatibility
rem All config files (settings, plugins, MCP, etc.) are stored
rem in the claude installation directory, not in C:\Users.
rem ============================================================

rem Resolve paths with drive letter. for %%~fI expands .. to an absolute
rem path; do this OUTSIDE any if (...) block — cmd.exe expands %VAR% inside
rem blocks at parse time, before for runs, yielding empty strings.
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "DEFAULT_NODE_PATH=%PROJECT_ROOT%\node-v18.20.8-win-x64\node.exe"
set "DEFAULT_CONFIG_DIR=%PROJECT_ROOT%\.claude"

rem Use computed defaults; override any stale env-var values from prior runs.
set "CLAUDE_CODE_NODE_PATH=%DEFAULT_NODE_PATH%"
set "CLAUDE_CONFIG_DIR=%DEFAULT_CONFIG_DIR%"

rem Check if portable Node.js exists
if not exist "%CLAUDE_CODE_NODE_PATH%" goto :missing_node

rem Auto-create .claude config directory
if not exist "%CLAUDE_CONFIG_DIR%" mkdir "%CLAUDE_CONFIG_DIR%" 2>nul

rem Set Windows 7 compatible Node.js options
set "NODE_OPTIONS=--no-warnings %NODE_OPTIONS%"

rem Node.js 18 blocks Win7 by default; skip the platform check
set "NODE_SKIP_PLATFORM_CHECK=1"

rem Launch Claude Code
"%CLAUDE_CODE_NODE_PATH%" "%~dp0cli-node.js" %*

goto :eof

:missing_node
echo [ERROR] Node.js not found at: %CLAUDE_CODE_NODE_PATH%
echo.
echo Please either:
echo   1. Set CLAUDE_CODE_NODE_PATH environment variable to your node.exe
echo   2. Place portable Node.js v18.20.8 at the expected path
echo   3. Expected location: %DEFAULT_NODE_PATH%
echo.
pause
exit /b 1
