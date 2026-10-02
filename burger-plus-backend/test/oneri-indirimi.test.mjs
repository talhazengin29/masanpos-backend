import test from "node:test";
import assert from "node:assert/strict";
import {
  dogrulanmisOneriIndirimYuzdesi,
  enAvantajliTemelFiyatiSec,
  indirimliFiyatHesapla,
  oneriIndirimAyariniDbdenGetir,
  oneriIndirimAyariniDogrula,
  oneriIndirimAyariniDonustur,
} from "../oneriIndirimi.js";

test("öneri indirimi varsayılan olarak kapalı ve yüzde 10 hazırlanır", () => {
  assert.deepEqual(oneriIndirimAyariniDonustur(), { aktif: false, indirimYuzde: 10 });
});

test("panel öneri indirimini yalnızca yüzde 1-50 aralığında kaydeder", () => {
  assert.deepEqual(oneriIndirimAyariniDogrula({ aktif: true, indirimYuzde: 10 }), { aktif: true, indirimYuzde: 10 });
  assert.throws(() => oneriIndirimAyariniDogrula({ aktif: true, indirimYuzde: 0 }), /%1-%50/);
  assert.throws(() => oneriIndirimAyariniDogrula({ aktif: true, indirimYuzde: 51 }), /%1-%50/);
});

test("100 liralık öneri yüzde 10 indirimle 90 liraya iner", () => {
  assert.equal(indirimliFiyatHesapla(100, 10), 90);
  assert.equal(indirimliFiyatHesapla(99.99, 10), 89.99);
});

test("kampanya ve öneri indirimi birleşmez, müşteri için avantajlı olan seçilir", () => {
  assert.deepEqual(
    enAvantajliTemelFiyatiSec({ temelFiyat: 100, kampanyaYuzde: 20, oneriIndirimYuzde: 10 }),
    { kaynak: "kampanya", fiyat: 80, indirimYuzde: 20 }
  );
  assert.deepEqual(
    enAvantajliTemelFiyatiSec({ temelFiyat: 100, kampanyaYuzde: 5, oneriIndirimYuzde: 10 }),
    { kaynak: "oneri", fiyat: 90, indirimYuzde: 10 }
  );
});

test("öneri indirimi yalnızca satırdaki bütün adetler doğrulanmışsa uygulanır", () => {
  assert.equal(dogrulanmisOneriIndirimYuzdesi({ guncelAyar: { aktif: true, indirimYuzde: 10 }, oneriAdedi: 2, toplamAdet: 2 }), 10);
  assert.equal(dogrulanmisOneriIndirimYuzdesi({ guncelAyar: { aktif: true, indirimYuzde: 10 }, oneriAdedi: 1, toplamAdet: 2 }), 0);
  assert.equal(dogrulanmisOneriIndirimYuzdesi({ guncelAyar: { aktif: true, indirimYuzde: 10 }, oneriAdedi: 0, toplamAdet: 1 }), 0);
});

test("yönetici ayarı kapattığında veya oranı değiştirdiğinde güncel ayar anında geçerli olur", () => {
  assert.equal(dogrulanmisOneriIndirimYuzdesi({ guncelAyar: { aktif: false, indirimYuzde: 10 }, oneriAdedi: 1, toplamAdet: 1 }), 0);
  assert.equal(dogrulanmisOneriIndirimYuzdesi({ guncelAyar: { aktif: true, indirimYuzde: 25 }, oneriAdedi: 1, toplamAdet: 1 }), 25);
});

test("ödeme ayarı önbellekten değil her kontrolde veritabanından okunur", async () => {
  let kayit = { aktif: true, indirimYuzde: 10 };
  const db = { query: async () => ({ rows: [{ deger: kayit }] }) };
  assert.deepEqual(await oneriIndirimAyariniDbdenGetir(db, 7), { aktif: true, indirimYuzde: 10 });
  kayit = { aktif: false, indirimYuzde: 25 };
  assert.deepEqual(await oneriIndirimAyariniDbdenGetir(db, 7), { aktif: false, indirimYuzde: 25 });
});
