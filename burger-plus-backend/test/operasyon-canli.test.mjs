import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sunucuKodu = await readFile(new URL("../server.js", import.meta.url), "utf8");

test("operasyon nabzi yalnizca yonetim odasina tenant kapsamli yayinlanir", () => {
  assert.match(
    sunucuKodu,
    /io\.to\(oda\(tenantId, "yonetim"\)\)\.emit\("operasyon-nabzi-guncellendi"/,
  );
  assert.match(sunucuKodu, /tur,[\s\S]{0,100}zaman: new Date\(\)\.toISOString\(\)/);
});

test("operasyon degisiklikleri Pulse olayini tetikler", () => {
  for (const tur of ["siparis", "nakit", "mutfak", "masa", "stok", "urun", "personel", "vardiya"]) {
    assert.match(
      sunucuKodu,
      new RegExp(`operasyonNabziDegisikliginiYayinla\\([^;]{0,220}"${tur}"`),
      `${tur} degisikligi icin Pulse olayi eksik`,
    );
  }
});
