G90 G21

G0 X4.7 Y1386.5 Z0.3 W-346.5 A-12.5 C223.5 ; boşta gezinme noktaları
G0 X17.4 Y1386.5 Z0.3 W-445.5 A-12.5 C223.5 ; boşta gezinme noktaları
G0 X21.6 Y1381.8 Z0.3 W-445.5 A-12.5 C223.5 ; ilk kaynak noktasına g0 ile yaklaşıyoruz
M3 ; kaynak aç komutu
G1 X20.7 Y1381.8 Z0.3 W-472.2 A-12.5 C223.5 F500 ; ilk kaynak noktasının bitiş noktasına g1 ile istenen hızda gidiyoruz.
M5 ; kaynak kapatıyoruz.
G0 X18.5 Y1381.8 Z0.3 W-381.3 A-12.5 C223.5; boşta gezinme noktaları
G0 X-3.8 Y1301.3 Z0.3 W-381.3 A-12.5 C223.5; boşta gezinme noktaları
G0 X1.1 Y1299.5 Z0.3 W-437.0 A-12.5 C223.5 ; ikinci kaynak noktasına g0 ile yaklaşıyoruz
M3 ; kaynak aç komutu 
; bu kaynak işleminde birden çok nokta var bu noktalara spline atılacak.
G1 X1.1 Y1299.5 Z0.3 W-456.2 A-12.5 C223.5 F500
G1 X5.1 Y1400.5 Z1.3 W-416.2 A-10.5 C255.5 F500
G1 X50.1 Y1450.5 Z5.3 W-406.2 A-5.5 C285.5 F500
M5 ;kaynak kapatıyoruz.
G0 X-5.4 Y1299.5 Z0.3 W-379.8 A-12.5 C223.5; boşta gezinme noktaları
M30
