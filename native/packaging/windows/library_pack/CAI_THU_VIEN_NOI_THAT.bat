@echo off
chcp 65001 >nul
echo MD CAD AI STUDIO - Cai thu vien noi that 3D (khong can Internet)
echo Dong phan mem MD CAD AI STUDIO truoc khi chay.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CAI_THU_VIEN_NOI_THAT.ps1"
if errorlevel 1 (echo LOI: khong cai duoc thu vien. Chup man hinh gui ho tro.) else (echo Da cai xong.)
pause
