import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dbKodu = await readFile(new URL("../db.js", import.meta.url), "utf8");
const adminDbKodu = await readFile(new URL("../adminDb.js", import.meta.url), "utf8");

test("oneri adedi istemciden alinmaz, imzali referanslardan dogrulanir", () => {
  assert.doesNotMatch(dbKodu, /ham\?\.oneriAdedi/);
  assert.match(dbKodu, /oneriAtiflariniDogrula\(pool/);
  assert.match(dbKodu, /referanslar: ham\?\.oneriReferanslari/);
  assert.match(dbKodu, /oneri_adedi\)/);
  assert.match(dbKodu, /olayTuru: "satin_alindi"/);
});

test("oneri cirosu tenant ve tarih kapsamli satis raporuna eklenir", () => {
  assert.match(adminDbKodu, /SUM\(fiyat\*LEAST\(adet,oneri_adedi\)\)/);
  assert.match(adminDbKodu, /WHERE isletme_id=\$1 AND olusturma >= NOW\(\)-\(\$2::text \|\| ' days'\)::interval/);
  assert.match(adminDbKodu, /oneriCirosu: Number\(ozet\.rows\[0\]\.oneri_cirosu\)/);
});
