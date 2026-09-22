import test from "node:test";
import assert from "node:assert/strict";
import { oneriAdediniSinirla, otomatikOnerileriSirala } from "../oneriMotoru.js";

const urunler = [
  { id: 1, ad: "Burger", urunTipi: "burger", aktif: true, stokta: true, sira: 1 },
  { id: 2, ad: "Patates", urunTipi: "yan_lezzet", aktif: true, stokta: true, sira: 2 },
  { id: 3, ad: "Ayran", urunTipi: "icecek", aktif: true, stokta: true, sira: 3 },
  { id: 4, ad: "Tatli", urunTipi: "diger", aktif: true, stokta: true, sira: 4 },
];

test("guvenilir birlikte satin alma verisi manuel secimden once gelir", () => {
  const sonuc = otomatikOnerileriSirala({
    urunler,
    sepetUrunIdleri: [1],
    manuelOneriIdleri: [3],
    istatistikler: [
      { urun_id: 2, birlikte_siparis: 4, toplam_siparis: 12, sepet_siparisi: 10 },
      { urun_id: 3, birlikte_siparis: 1, toplam_siparis: 30, sepet_siparisi: 10 },
    ],
  });

  assert.equal(sonuc[0].id, 2);
  assert.equal(sonuc[0].oneriNedeni, "birlikte_aliniyor");
  assert.equal(sonuc[0].oneriGuveni, 40);
});

test("az veri otomatik iliski gibi sunulmaz ve manuel secim yedek olur", () => {
  const sonuc = otomatikOnerileriSirala({
    urunler,
    sepetUrunIdleri: [1],
    manuelOneriIdleri: [3],
    istatistikler: [{ urun_id: 2, birlikte_siparis: 1, toplam_siparis: 2, sepet_siparisi: 2 }],
  });

  assert.equal(sonuc[0].id, 3);
  assert.equal(sonuc[0].oneriNedeni, "isletme_secimi");
  assert.equal(sonuc[0].oneriGuveni, null);
});

test("sepetteki, pasif ve stokta olmayan urunler onerilmez", () => {
  const sonuc = otomatikOnerileriSirala({
    urunler: [
      ...urunler,
      { id: 5, ad: "Kola", urunTipi: "icecek", aktif: true, stokta: false },
      { id: 6, ad: "Soda", urunTipi: "icecek", aktif: false, stokta: true },
    ],
    sepetUrunIdleri: [1, 2],
    manuelOneriIdleri: [1, 2, 5, 6, 3],
    istatistikler: [{ urun_id: 5, birlikte_siparis: 10, toplam_siparis: 20, sepet_siparisi: 10 }],
  });

  assert.deepEqual(sonuc.map((urun) => urun.id), [3]);
});

test("satis gecmisi yoksa tamamlayici urun tipi devreye girer", () => {
  const sonuc = otomatikOnerileriSirala({ urunler, sepetUrunIdleri: [1], limit: 2 });

  assert.deepEqual(sonuc.map((urun) => urun.id), [2, 3]);
  assert.ok(sonuc.every((urun) => urun.oneriNedeni === "populer"));
});

test("oneri atfi urun adedini asamaz ve gecersiz degerleri sifirlar", () => {
  assert.equal(oneriAdediniSinirla(2, 3), 2);
  assert.equal(oneriAdediniSinirla(8, 3), 3);
  assert.equal(oneriAdediniSinirla(-2, 3), 0);
  assert.equal(oneriAdediniSinirla("gecersiz", 3), 0);
});
