import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { oneriHunisiniDonustur } from "../adminDb.js";

test("oneri hunisi adetleri ve asama oranlarini hesaplar", () => {
  assert.deepEqual(oneriHunisiniDonustur({
    goruntulenme: "200", tiklama: "80", sepete_ekleme: "40", satin_alma: "10", goruntulenme_oturumu: "65",
  }), {
    goruntulenme: 200,
    tiklama: 80,
    sepeteEkleme: 40,
    satinAlma: 10,
    goruntulenmeOturumu: 65,
    tiklamaOrani: 40,
    sepeteEklemeOrani: 50,
    satinAlmaOrani: 25,
    toplamDonusumOrani: 5,
  });
});

test("bos hunide NaN veya Infinity uretmez", () => {
  const sonuc = oneriHunisiniDonustur({});
  assert.equal(sonuc.toplamDonusumOrani, 0);
  assert.equal(sonuc.tiklamaOrani, 0);
  assert.ok(Object.values(sonuc).every(Number.isFinite));
});

test("oneri raporu tenant ve tarih kapsamli olaylari kullanir", async () => {
  const kod = await readFile(new URL("../adminDb.js", import.meta.url), "utf8");
  assert.match(kod, /FROM oneri_olaylari/);
  assert.match(kod, /WHERE isletme_id=\$1 AND olusturma >= NOW\(\)-\(\$2::text \|\| ' days'\)::interval/);
  assert.match(kod, /WHERE e\.isletme_id=\$1 AND e\.olusturma >= NOW\(\)-\(\$2::text \|\| ' days'\)::interval/);
});

test("oneri siralamasi yalnizca ayni sepet baglamindaki performansi kullanir", async () => {
  const kod = await readFile(new URL("../adminDb.js", import.meta.url), "utf8");
  assert.match(kod, /o\.kaynak_urun_idleri && \$2::int\[\]/);
  assert.match(kod, /performanslar: performansSonucu\.rows/);
});
