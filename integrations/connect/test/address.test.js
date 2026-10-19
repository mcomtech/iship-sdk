import assert from "node:assert/strict";
import test from "node:test";

import { applyOverrides, isShippable, normalizePhone, parseThaiAddress, thaiProvince } from "../dist/index.js";

const fields = (issues, code) => issues.filter((i) => i.code === code).map((i) => i.field).sort();

test("reads ต./อ./จ. markers out of the address line", () => {
  const { address, issues } = parseThaiAddress({
    name: "สมชาย ใจดี",
    phone: "081-234-5678",
    line1: "123/4 ม.5 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200",
    province: "Chiang Mai",
    provinceCode: "TH-50",
    zip: "50200",
    countryCode: "TH",
  });

  assert.deepEqual(address, {
    name: "สมชาย ใจดี",
    phone: "0812345678",
    address: "123/4 ม.5",
    subdistrict: "สุเทพ",
    district: "เมืองเชียงใหม่",
    province: "เชียงใหม่",
    zipcode: "50200",
  });
  assert.deepEqual(issues, []);
});

test("handles Bangkok's แขวง/เขต on the second line", () => {
  const { address, issues } = parseThaiAddress({
    name: "ร้านทดสอบ",
    phone: "+66 81 234 5678",
    line1: "44/247 ซอยสายไหม 3",
    line2: "แขวงสายไหม เขตสายไหม",
    city: "Bangkok",
    province: "Bangkok",
    provinceCode: "TH-10",
    zip: "10220",
    countryCode: "TH",
  });

  assert.equal(address.address, "44/247 ซอยสายไหม 3");
  assert.equal(address.subdistrict, "สายไหม");
  assert.equal(address.district, "สายไหม");
  assert.equal(address.province, "กรุงเทพมหานคร");
  assert.equal(address.phone, "0812345678");
  assert.deepEqual(issues, []);
});

test("splits parts typed with no spaces between them", () => {
  const { address, issues } = parseThaiAddress({
    name: "ก",
    phone: "0891234567",
    line1: "12 ถ.นิมมานเหมินท์ ต.สุเทพอ.เมืองจ.เชียงใหม่50200",
    countryCode: "TH",
  });

  assert.equal(address.address, "12 ถ.นิมมานเหมินท์");
  assert.equal(address.subdistrict, "สุเทพ");
  assert.equal(address.district, "เมืองเชียงใหม่");
  assert.equal(address.province, "เชียงใหม่");
  assert.equal(address.zipcode, "50200");
  assert.deepEqual(issues, []);
});

test("takes the district from city and guesses the subdistrict from line 2", () => {
  const { address, issues } = parseThaiAddress({
    name: "ผู้รับ",
    phone: "0891234567",
    line1: "99 หมู่ 2",
    line2: "บางเมือง",
    city: "เมืองสมุทรปราการ",
    provinceCode: "TH-11",
    zip: "10270",
    countryCode: "TH",
  });

  assert.equal(address.address, "99 หมู่ 2");
  assert.equal(address.subdistrict, "บางเมือง");
  assert.equal(address.district, "เมืองสมุทรปราการ");
  assert.equal(address.province, "สมุทรปราการ");
  assert.deepEqual(fields(issues, "guessed"), ["subdistrict"]);
  assert.ok(isShippable(issues));
});

test("reports what it cannot find instead of inventing it", () => {
  const { issues } = parseThaiAddress({
    name: "",
    phone: "12",
    line1: "55 ถนนสุขุมวิท",
    city: "กรุงเทพมหานคร",
    countryCode: "TH",
  });

  assert.deepEqual(fields(issues, "missing"), ["district", "name", "subdistrict", "zipcode"]);
  assert.deepEqual(fields(issues, "invalid"), ["phone"]);
  assert.ok(!isShippable(issues));
});

test("flags an address outside Thailand", () => {
  const { issues } = parseThaiAddress({ countryCode: "US", line1: "1 Main St" });
  assert.ok(issues.some((i) => i.field === "country" && i.code === "not_thailand"));
});

test("corrections replace the parsed values and clear their issues", () => {
  const parsed = parseThaiAddress({
    name: "ผู้รับ",
    phone: "0891234567",
    line1: "55 ถนนสุขุมวิท",
    city: "วัฒนา",
    provinceCode: "TH-10",
    zip: "10110",
    countryCode: "TH",
  });
  assert.deepEqual(fields(parsed.issues, "missing"), ["subdistrict"]);

  const fixed = applyOverrides(parsed, { subdistrict: "คลองเตยเหนือ", district: "", phone: "+66891234567" });
  assert.equal(fixed.address.subdistrict, "คลองเตยเหนือ");
  assert.equal(fixed.address.district, "วัฒนา");
  assert.deepEqual(fixed.issues, []);

  const broken = applyOverrides(parsed, { subdistrict: "คลองเตยเหนือ", zipcode: "1011" });
  assert.deepEqual(fields(broken.issues, "invalid"), ["zipcode"]);
});

test("province names, aliases and codes resolve to the Thai name", () => {
  assert.equal(thaiProvince("TH-10"), "กรุงเทพมหานคร");
  assert.equal(thaiProvince("กทม."), "กรุงเทพมหานคร");
  assert.equal(thaiProvince("กรุงเทพฯ"), "กรุงเทพมหานคร");
  assert.equal(thaiProvince("Lopburi"), "ลพบุรี");
  assert.equal(thaiProvince("Phang-nga"), "พังงา");
  assert.equal(thaiProvince("จ.ขอนแก่น"), "ขอนแก่น");
  assert.equal(thaiProvince("TH-S"), "ชลบุรี");
  assert.equal(thaiProvince("Atlantis"), undefined);
});

test("phone numbers are normalised to the domestic form", () => {
  assert.equal(normalizePhone("+66 89 123 4567"), "0891234567");
  assert.equal(normalizePhone("891234567"), "0891234567");
  assert.equal(normalizePhone("02-123-4567"), "021234567");
});
