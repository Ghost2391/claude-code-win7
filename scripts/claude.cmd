@echo off
rem ============================================================
rem Claude Code Launcher (Windows)
rem
rem Runs the built dist/cli.js with whichever runtime is available:
rem  1. node on PATH (the bundle is patched for Node >= 22, e.g. Node 24)
rem  2. bun on PATH
rem Config lives in the standard ~/.claude or %CLAUDE_CONFIG_DIR%.
rem ============================================================
setlocal

rem Resolve the directory containing this script.
for %%I in ("%~dp0.") do set "SCRIPT_DIR=%%~fI"

set "CLI_JS=%SCRIPT_DIR%\cli-node.js"
if not exist "%CLI_JS%" goto :missing_cli

rem Prefer node (the bundle is patched for node), fall back to bun.
where node >nul 2>nul
if %errorlevel%==0 (
  node "%CLI_JS%" %*
  exit /b %errorlevel%
)

where bun >nul 2>nul
if %errorlevel%==0 (
  bun "%CLI_JS%" %*
  exit /b %errorlevel%
)

echo [ERROR] Neither node nor bun was found on PATH.
echo Install Node.js 22 or newer (or Bun), then re-run this script.
pause
exit /b 1

:missing_cli
echo [ERROR] dist\cli-node.js not found next to this script. Run `bun run build` first.
pause
exit /b 1
