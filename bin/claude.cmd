@echo off
rem Convenience launcher for Claude Code Win7
rem Delegates to dist\claude.cmd

set "SCRIPT_DIR=%~dp0"
call "%SCRIPT_DIR%..\dist\claude.cmd" %*
