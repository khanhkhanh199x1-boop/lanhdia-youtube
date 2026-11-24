@echo off
setlocal DisableDelayedExpansion
set "HOST_DIR=%LOCALAPPDATA%\LanhDiaYouTube\ChromeHub"
if not exist "%HOST_DIR%\LanhDiaChromeHost.exe" goto done
"%HOST_DIR%\LanhDiaChromeHost.exe" --uninstall
if errorlevel 1 goto error
del /q "%HOST_DIR%\native-messaging.json" "%HOST_DIR%\LanhDiaChromeHost.exe" 2>nul
:done
echo Da go dang ky Helper va xoa hang cho tren may. Ho so Chrome khong bi xoa.
pause
exit /b 0
:error
echo Khong go duoc Helper. Thu lai sau khi dong cac lan thiet lap.
pause
exit /b 1
