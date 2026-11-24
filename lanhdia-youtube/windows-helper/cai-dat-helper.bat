@echo off
setlocal DisableDelayedExpansion
set "HOST_DIR=%LOCALAPPDATA%\LanhDiaYouTube\ChromeHub"
set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" goto missing
if not exist "%HOST_DIR%" mkdir "%HOST_DIR%"
"%CSC%" /nologo /optimize+ /target:exe /r:System.Web.Extensions.dll /out:"%HOST_DIR%\LanhDiaChromeHost.exe" "%~dp0Host.cs" "%~dp0BuildInfo.cs"
if errorlevel 1 goto error
"%HOST_DIR%\LanhDiaChromeHost.exe" --install
if errorlevel 1 goto error
echo.
echo Da cai Windows Helper cho tai khoan hien tai.
echo Quay lai Chrome -^> Quan ly Kenh -^> Kiem tra ket noi.
pause
exit /b 0
:missing
echo Can .NET Framework 4.x tren Windows 10/11. Khong cai duoc.
goto finish
:error
echo Khong the cai Helper. Dong cac lan thiet lap dang chay roi thu lai.
:finish
pause
exit /b 1
