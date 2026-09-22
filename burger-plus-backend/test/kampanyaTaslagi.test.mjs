import test from "node:test";
import assert from "node:assert/strict";
import { kampanyaTaslagiOlustur } from "../kampanyaTaslagi.js";

test("en cok oneri cirosu ureten kategori kampanya taslagina donusur", () => {
  const sonuc = kampanyaTaslagiOlustur({
    kategoriIstatistikleri: [
      { kategori: "Icecekler", aktif_urun: 4, adet: 30, ciro: 3000, oneri_adedi: 8, oneri_cirosu: 800, tamamlayici_adet: 30 },
      { kategori: "Yan Lezzetler", aktif_urun: 3, adet: 50, ciro: 5000, oneri_adedi: 4, oneri_cirosu: 400, tamamlayici_adet: 50 },
    ],
    saatlik: [{ saat: 12, siparis: 20 }, { saat: 13, siparis: 18 }, { saat: 14, siparis: 4 }, { saat: 15, siparis: 3 }, { saat: 16, siparis: 2 }, { saat: 17, siparis: 12 }],
    gun: 30,
  });

  assert.deepEqual(sonuc.taslak.gecerliKategoriler, ["Icecekler"]);
  assert.equal(sonuc.taslak.aktif, false);
  assert.equal(sonuc.analiz.strateji, "oneri_performansi");
  assert.equal(sonuc.analiz.oneriCirosu, 800);
});

test("satis saatlerinden en sakin uc saatlik aralik secilir", () => {
  const sonuc = kampanyaTaslagiOlustur({
    kategoriIstatistikleri: [{ kategori: "Icecekler", aktif_urun: 2, adet: 10, tamamlayici_adet: 10 }],
    saatlik: [{ saat: 11, siparis: 12 }, { saat: 12, siparis: 10 }, { saat: 13, siparis: 8 }, { saat: 14, siparis: 1 }, { saat: 15, siparis: 1 }, { saat: 16, siparis: 1 }, { saat: 17, siparis: 7 }],
  });

  assert.equal(sonuc.taslak.baslangicSaat, 14);
  assert.equal(sonuc.taslak.bitisSaat, 17);
  assert.equal(sonuc.analiz.saatVerisiyleBelirlendi, true);
});

test("oneri verisi yoksa tamamlayici urun satisi guvenli yedek olur", () => {
  const sonuc = kampanyaTaslagiOlustur({
    kategoriIstatistikleri: [
      { kategori: "Burgerler", aktif_urun: 5, adet: 100, tamamlayici_adet: 0 },
      { kategori: "Icecekler", aktif_urun: 3, adet: 20, tamamlayici_adet: 20 },
    ],
  });

  assert.deepEqual(sonuc.taslak.gecerliKategoriler, ["Icecekler"]);
  assert.equal(sonuc.analiz.strateji, "tamamlayici_satis");
  assert.equal(sonuc.analiz.veriSeviyesi, "baslangic");
});

test("aktif kategori yoksa bos taslak uretilmez", () => {
  assert.throws(() => kampanyaTaslagiOlustur({}), /aktif bir ürün kategorisi/);
});
