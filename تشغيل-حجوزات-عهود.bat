@echo off
chcp 65001 >nul
title Ohood Booking
cd /d "%~dp0"
echo.
echo  ====================================
echo    Ohood Booking  -  Local Server
echo  ====================================
echo.
echo  Starting... a browser tab will open.
echo  Keep this window open while using the app.
echo.
node server.js
echo.
echo  Server stopped.
pause >nul
