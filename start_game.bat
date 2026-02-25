@echo off
echo Spoustim herni server Pixelova Rise (VERZE 110)...
echo Hra bude dostupna na http://localhost:8001
echo Pro jistotu jsme zmenili port, aby se obesla mezipamet prohlizece.
start http://localhost:8001
py -m http.server 8001
pause
