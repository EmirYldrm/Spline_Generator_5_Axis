# Spline_Generator_5_Axis

GitHub Pages üzerinde build veya npm paketi olmadan çalışan, tarayıcı tabanlı 5 eksenli spline kaynak yolu aracı.

## Kullanım

1. Depoyu GitHub'a gönderin.
2. **Settings → Pages → Build and deployment → Source** bölümünde **GitHub Actions** seçin.
3. `main` dalına gönderimden sonra dağıtım otomatik başlar. Uygulama kök dizinden yayınlanır.
4. 3D görünüm için tarayıcının `cdn.jsdelivr.net` adresine erişebilmesi gerekir. Three.js ve OrbitControls sabit `0.160.0` sürümünden yüklenir.

Yerelde `index.html` dosyasını `file://` ile açmak ES module kısıtları nedeniyle desteklenmez; herhangi bir derleme yapmadan statik dosya sunucusu veya GitHub Pages üzerinden açın.

## Veri biçimleri

- G-code koordinat kelimeleri (`G0` / `G1`, X/Y/Z/C/A); yorumlar `;` ve parantezle yazılabilir.
- Başlıklı veya başlıksız CSV, boşluk ya da sekme ayracı. Başlıksız sütun sırası `X Y Z C A` şeklindedir.
- Eksik eksenler önceki modal değerini korur; ilk noktanın eksik değerleri sıfırdır.
- Nokta/proje dosyaları ve ayarlar tarayıcıda kalır. İsteğe bağlı ayarlar `swSpline:` anahtarıyla localStorage'da saklanır.

## Spline ve makine konvansiyonu

Catmull–Rom, natural, clamped ve lineer yöntemler ortak XYZ-kiriş parametresini kullanır; Catmull–Rom knot aralığı centripetal (kiriş uzunluğunun karekökü) seçilir. Çıkış XYZ yay uzunluğuna göre yeniden örneklenir. Chordal tolerans modunda eğrilik yerel örneklerden kestirilir; örnek aralığı düz bölgelerde en fazla 10 mm ile sınırlandırılır. Rotary hareketin olduğu sabit XYZ aralıkları da örneklerde korunur.

Unwrap 180° üzerindeki farkları önceki rotary hareket yönüyle birlikte yorumlar (ör. 350° → 10° = 350° → 370°; artan yönde ilerleyen 10° → 350° geçişi ise 350° olarak korunur). Önceki yön bilinmiyorsa 180° üzerindeki tek bir geçiş belirsizdir ve en küçük tur geçişi varsayılır; yönü açıkça belirtmek için önceki noktalara devam eden açı değerleri girin veya unwrap'i kapatın.

Torç yönü varsayımı `getToolDirection(c, a)` içinde: başlangıç doğrultusu makine Z ekseninde `-Z`, A bu eksen etrafında eğim, C ise Z çevresinde döndürmedir. A/C işaretleri ve torç ofseti gerçek makine kinematiğiyle doğrulanmalıdır. Güvenli Z, `G4 P` zaman birimi ve M kodları kontrolcüye göre ayarlanmalıdır; G-code'u makinede çalıştırmadan önce kontrolcü dokümantasyonuyla doğrulayın.

## Spline motoru testleri

Node.js ile, harici paket kurmadan çalıştırın:

```text
node tests/spline.test.mjs
```
