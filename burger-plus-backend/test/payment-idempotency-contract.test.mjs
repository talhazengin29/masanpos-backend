import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dbKodu = await readFile(new URL("../db.js", import.meta.url), "utf8");
const sunucuKodu = await readFile(new URL("../server.js", import.meta.url), "utf8");

test("ödeme ve nakit sipariş kayıtları idempotency anahtarıyla veritabanında tekilleştirilir", () => {
  assert.match(dbKodu, /odeme_islemleri_idempotency_unique/);
  assert.match(dbKodu, /'odeme-taslagi'/);
  assert.match(dbKodu, /'nakit-siparis'/);
  assert.match(dbKodu, /ON CONFLICT \(isletme_id,idempotency_kapsam,idempotency_anahtar\)/);
});

test("iyzico oturumu ve mutfak aktarımı atomik sahiplik alanları kullanır", () => {
  assert.match(dbKodu, /iyzico_baslatim_basladi=NOW\(\)/);
  assert.match(dbKodu, /saglayici_sayfa_url=\$4/);
  assert.match(dbKodu, /mutfaga_aktarim_basladi=NOW\(\)/);
  assert.match(sunucuKodu, /odemeIyzicoBaslatiminiTalepEt/);
  assert.match(sunucuKodu, /odemeMutfakAktariminiTalepEt/);
});

test("kritik HTTP uçları ortak idempotent yanıt katmanından geçer", () => {
  for (const kapsam of [
    "odeme-taslagi",
    "odeme-cuzdan-onay",
    "iyzico-baslat",
    "iyzico-dogrula",
    "nakit-siparis",
    "nakit-siparis-onay",
    "nakit-siparis-red",
    "nakit-siparis-tahsil",
  ]) {
    assert.match(sunucuKodu, new RegExp(`idempotentYanitiGonder\\([\\s\\S]{0,160}[\"']${kapsam}[\"']`));
  }
});
