import test from "node:test";
import assert from "node:assert/strict";
import {
  IdempotencyHatasi,
  idempotencyAnahtariniDogrula,
  idempotencyIstegiOzeti,
  idempotencyTablosunuHazirla,
  idempotentIslemCalistir,
} from "../idempotency.js";

class BellekHavuzu {
  constructor() { this.kayitlar = new Map(); }
  anahtar(parametreler) { return parametreler.slice(0, 3).join("|"); }
  async query(sql, parametreler = []) {
    const sorgu = sql.replace(/\s+/g, " ").trim();
    const anahtar = this.anahtar(parametreler);
    if (sorgu.startsWith("DELETE FROM idempotency_kayitlari")) return { rows: [] };
    if (sorgu.startsWith("SELECT istek_ozeti")) {
      const kayit = this.kayitlar.get(anahtar);
      return { rows: kayit ? [{ ...kayit }] : [] };
    }
    if (sorgu.startsWith("INSERT INTO idempotency_kayitlari")) {
      if (this.kayitlar.has(anahtar)) return { rows: [] };
      this.kayitlar.set(anahtar, {
        istek_ozeti: parametreler[3], aktor_turu: parametreler[4], aktor_id: parametreler[5],
        durum: "isleniyor", yanit_kodu: null, yanit_govdesi: null,
      });
      return { rows: [{ id: 1 }] };
    }
    if (sorgu.includes("AND (durum='basarisiz'")) {
      const kayit = this.kayitlar.get(anahtar);
      if (!kayit || kayit.durum !== "basarisiz" || kayit.istek_ozeti !== parametreler[3]
        || kayit.aktor_turu !== parametreler[4] || kayit.aktor_id !== parametreler[5]) return { rows: [] };
      Object.assign(kayit, { durum: "isleniyor", yanit_kodu: null, yanit_govdesi: null });
      return { rows: [{ id: 1 }] };
    }
    if (sorgu.includes("SET durum='tamamlandi'")) {
      const kayit = this.kayitlar.get(anahtar);
      Object.assign(kayit, { durum: "tamamlandi", yanit_kodu: parametreler[3], yanit_govdesi: JSON.parse(parametreler[4]) });
      return { rows: [] };
    }
    if (sorgu.includes("SET durum='basarisiz'")) {
      const kayit = this.kayitlar.get(anahtar);
      if (kayit) kayit.durum = "basarisiz";
      return { rows: [] };
    }
    throw new Error(`Beklenmeyen test sorgusu: ${sorgu}`);
  }
}

const AYARLAR = {
  isletmeId: 7,
  kapsam: "odeme-taslagi",
  anahtar: "order:550e8400-e29b-41d4-a716-446655440000",
  istekOzeti: idempotencyIstegiOzeti({ metot: "POST", yol: "/api/odeme/taslak", govde: { masaNo: "12", urunler: [{ id: 3, adet: 1 }] } }),
  aktorTuru: "masa",
  aktorId: "12",
};

test("idempotency anahtarı biçimi doğrulanır", () => {
  assert.equal(idempotencyAnahtariniDogrula(AYARLAR.anahtar), AYARLAR.anahtar);
  assert.throws(() => idempotencyAnahtariniDogrula("kisa"), (hata) => hata.status === 400);
  assert.throws(() => idempotencyAnahtariniDogrula("boşluk içeren anahtar"), (hata) => hata.status === 400);
});

test("istek özeti nesne alan sırasından etkilenmez", () => {
  const bir = idempotencyIstegiOzeti({ metot: "POST", yol: "/x", govde: { b: 2, a: { d: 4, c: 3 } } });
  const iki = idempotencyIstegiOzeti({ yol: "/x", govde: { a: { c: 3, d: 4 }, b: 2 }, metot: "POST" });
  assert.equal(bir, iki);
});

test("idempotency tablosu tenant kapsamı ve anahtarı birlikte tekilleştirir", async () => {
  const sorgular = [];
  await idempotencyTablosunuHazirla({ query: async (sql) => { sorgular.push(sql); return { rows: [] }; } });
  const sema = sorgular.join("\n");
  assert.match(sema, /UNIQUE\s*\(isletme_id,\s*kapsam,\s*anahtar\)/i);
  assert.match(sema, /son_gecerlilik/i);
  assert.match(sema, /yanit_govdesi\s+JSONB/i);
});

test("eşzamanlı aynı istek yalnızca bir kez çalışır ve yanıt tekrar oynatılır", async () => {
  const pool = new BellekHavuzu();
  let calismaSayisi = 0;
  let tamamla;
  const beklet = new Promise((resolve) => { tamamla = resolve; });
  const islem = async () => {
    calismaSayisi += 1;
    await beklet;
    return { durumKodu: 201, govde: { odeme: { id: "tek-kayit" } } };
  };
  const birinci = idempotentIslemCalistir(pool, AYARLAR, islem);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const ikinci = idempotentIslemCalistir(pool, AYARLAR, islem);
  tamamla();
  const sonuclar = await Promise.all([birinci, ikinci]);
  assert.equal(calismaSayisi, 1);
  assert.deepEqual(sonuclar.map((sonuc) => sonuc.tekrar).sort(), [false, true]);
  assert.deepEqual(sonuclar[0].govde, sonuclar[1].govde);
});

test("aynı anahtar farklı payload ile kullanılamaz", async () => {
  const pool = new BellekHavuzu();
  await idempotentIslemCalistir(pool, AYARLAR, async () => ({ durumKodu: 201, govde: { tamam: true } }));
  const farkli = { ...AYARLAR, istekOzeti: idempotencyIstegiOzeti({ metot: "POST", yol: "/api/odeme/taslak", govde: { masaNo: "13" } }) };
  await assert.rejects(
    idempotentIslemCalistir(pool, farkli, async () => ({ durumKodu: 201, govde: {} })),
    (hata) => hata instanceof IdempotencyHatasi && hata.status === 409,
  );
});

test("başarısız işlem aynı gövde ve anahtarla yeniden denenebilir", async () => {
  const pool = new BellekHavuzu();
  await assert.rejects(idempotentIslemCalistir(pool, AYARLAR, async () => { throw new Error("geçici hata"); }));
  const sonuc = await idempotentIslemCalistir(pool, AYARLAR, async () => ({ durumKodu: 200, govde: { tamam: true } }));
  assert.equal(sonuc.tekrar, false);
  assert.deepEqual(sonuc.govde, { tamam: true });
});
