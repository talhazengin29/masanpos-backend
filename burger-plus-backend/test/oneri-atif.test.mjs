import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  oneriAtifTablolariniHazirla,
  oneriAtiflariniDogrula,
  oneriOlayiKaydet,
  oneriOturumuOlustur,
  oneriReferansiOlustur,
  oneriReferansiniDogrula,
} from "../oneriAtif.js";

process.env.ONERI_REFERANS_SECRET ||= "test-only-recommendation-secret-32-chars";

test("imzali oneri referansi tenant, urun ve sureye baglidir", () => {
  const simdi = Date.now();
  const referans = oneriReferansiOlustur({ oturumId: randomUUID(), isletmeId: 7, urunIdleri: [11, 12], simdi, omurSaniye: 60 });
  assert.equal(oneriReferansiniDogrula(referans, { isletmeId: 7, urunId: 11, simdi }).tid, 7);
  assert.throws(() => oneriReferansiniDogrula(`${referans.slice(0, -1)}x`, { isletmeId: 7, urunId: 11 }), /doğrulanamadı/);
  assert.throws(() => oneriReferansiniDogrula(referans, { isletmeId: 8, urunId: 11, simdi }), (e) => e.kod === "ONERI_REFERANSI_ISLETME_UYUSMAZLIGI");
  assert.throws(() => oneriReferansiniDogrula(referans, { isletmeId: 7, urunId: 99, simdi }), (e) => e.kod === "ONERI_REFERANSI_URUN_UYUSMAZLIGI");
  assert.throws(() => oneriReferansiniDogrula(referans, { isletmeId: 7, urunId: 11, simdi: simdi + 61_000 }), (e) => e.kod === "ONERI_REFERANSI_SURESI_DOLDU");
});

test("gercek PostgreSQL ile oneri olaylari ve satin alma atfi", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Client } = await import("pg");
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: process.env.PGSSL === "false" ? false : undefined });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL search_path TO pg_temp");
    await db.query("CREATE TABLE isletmeler (id INTEGER PRIMARY KEY)");
    await db.query("CREATE TABLE kullanicilar (id INTEGER PRIMARY KEY, isletme_id INTEGER REFERENCES isletmeler(id))");
    await db.query("INSERT INTO isletmeler(id) VALUES (1),(2)");
    await oneriAtifTablolariniHazirla(db);
    const oturum = await oneriOturumuOlustur(db, { isletmeId: 1, kaynakUrunIdleri: [5], onerilenUrunIdleri: [9] });
    const referans = oneriReferansiOlustur({ oturumId: oturum.id, isletmeId: 1, urunIdleri: [9] });
    await oneriOlayiKaydet(db, { isletmeId: 1, oturumId: oturum.id, urunId: 9, olayTuru: "goruntulendi", olayAnahtari: randomUUID() });
    await oneriOlayiKaydet(db, { isletmeId: 1, oturumId: oturum.id, urunId: 9, olayTuru: "tiklandi", olayAnahtari: randomUUID() });
    await oneriOlayiKaydet(db, { isletmeId: 1, oturumId: oturum.id, urunId: 9, olayTuru: "sepete_eklendi", adet: 3, olayAnahtari: randomUUID() });
    const atif = await oneriAtiflariniDogrula(db, { isletmeId: 1, urunId: 9, adet: 2, referanslar: [referans] });
    assert.equal(atif.oneriAdedi, 2);
    assert.equal(atif.atiflar[0].oturumId, oturum.id);
    await oneriOlayiKaydet(db, {
      isletmeId: 1, oturumId: oturum.id, urunId: 9, olayTuru: "satin_alindi", adet: 2,
      olayAnahtari: randomUUID(), odemeId: randomUUID(), odemeKalemNo: 0,
    });
    const olaylar = await db.query("SELECT olay_turu FROM oneri_olaylari ORDER BY id");
    assert.deepEqual(olaylar.rows.map((satir) => satir.olay_turu), ["goruntulendi", "tiklandi", "sepete_eklendi", "satin_alindi"]);
    await assert.rejects(() => oneriAtiflariniDogrula(db, { isletmeId: 2, urunId: 9, adet: 1, referanslar: [referans] }), (e) => e.kod === "ONERI_REFERANSI_ISLETME_UYUSMAZLIGI");
    await db.query("ROLLBACK");
  } finally {
    await db.end();
  }
});
