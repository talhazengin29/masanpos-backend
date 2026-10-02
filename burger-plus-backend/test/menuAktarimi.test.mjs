import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fiyatCoz, menuAnaliziniDogrula, menuGorseliniAnalizEt } from "../menuAktarimi.js";

test("Türkçe fiyat biçimlerini sayıya dönüştürür", () => {
  assert.equal(fiyatCoz("1.000 TL"), 1000);
  assert.equal(fiyatCoz("₺300,50"), 300.5);
  assert.equal(fiyatCoz("1.250,75"), 1250.75);
});

test("AI çıktısını doğrular, tekrarları ve geçersiz satırları ayıklar", () => {
  const sonuc = menuAnaliziniDogrula({
    categories: [{
      name: " Başlangıçlar ", confidence: 1.4, products: [
        { name: "Çorba", description: "Günün çorbası", price: 150, currency: "try", confidence: .94 },
        { name: "Çorba", description: "Tekrar", price: 150, currency: "TRY", confidence: .8 },
        { name: "Fiyatsız", description: "", price: -1, currency: "TRY", confidence: .5 },
      ],
    }],
    warnings: ["Bir satır okunamadı"],
  });
  assert.equal(sonuc.urunSayisi, 1);
  assert.equal(sonuc.kategoriler[0].ad, "Başlangıçlar");
  assert.equal(sonuc.kategoriler[0].guven, 1);
  assert.equal(sonuc.kategoriler[0].urunler[0].paraBirimi, "TRY");
  assert.deepEqual(sonuc.uyarilar, ["Bir satır okunamadı"]);
});

test("görseli pasif JPEG olarak Gemini structured output isteğine ekler", async () => {
  const oncekiAnahtar = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  const gorsel = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  let istek;
  try {
    const sonuc = await menuGorseliniAnalizEt(gorsel, { fetchImpl: async (url, ayarlar) => {
      istek = { url, ayarlar, govde: JSON.parse(ayarlar.body) };
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          categories: [{ name: "Tatlılar", confidence: .98, products: [{ name: "Künefe", description: "", price: 300, currency: "TRY", confidence: .96 }] }],
          warnings: [],
        }) }] } }] }),
      };
    } });
    assert.equal(sonuc.urunSayisi, 1);
    assert.match(istek.url, /:generateContent$/);
    assert.equal(istek.ayarlar.headers["x-goog-api-key"], "test-key");
    assert.equal(istek.govde.generationConfig.responseMimeType, "application/json");
    assert.equal(istek.govde.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
    assert.ok(istek.govde.contents[0].parts[1].inlineData.data.length > 10);
  } finally {
    if (oncekiAnahtar) process.env.GEMINI_API_KEY = oncekiAnahtar;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("PDF menüyü yeniden çalıştırmadan Gemini'ye PDF olarak iletir", async () => {
  const oncekiAnahtar = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
  let mime;
  try {
    await menuGorseliniAnalizEt(pdf, { fetchImpl: async (_url, ayarlar) => {
      mime = JSON.parse(ayarlar.body).contents[0].parts[1].inlineData.mimeType;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        categories: [{ name: "İçecekler", confidence: .9, products: [{ name: "Ayran", description: "", price: 50, currency: "TRY", confidence: .9 }] }], warnings: [],
      }) }] } }] }) };
    } });
    assert.equal(mime, "application/pdf");
  } finally {
    if (oncekiAnahtar) process.env.GEMINI_API_KEY = oncekiAnahtar;
    else delete process.env.GEMINI_API_KEY;
  }
});
