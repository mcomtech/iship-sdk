import type { Address } from "@iship/sdk";

import { BANGKOK, thaiProvince } from "./provinces.js";

/**
 * An address as a shop platform stores it: free-text lines plus city,
 * province and postcode. Thai checkouts have no subdistrict or district field,
 * so customers type them into the lines (often as "ต.สุเทพ อ.เมือง") or put the
 * district in `city`.
 */
export interface RawAddress {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  province?: string | null;
  /** ISO 3166-2 code such as "TH-50", when the platform supplies one. */
  provinceCode?: string | null;
  zip?: string | null;
  /** ISO 3166-1 alpha-2, e.g. "TH". */
  countryCode?: string | null;
}

export type AddressField = keyof Address;

/**
 * Something about an address that a person should look at.
 *
 * `missing` and `invalid` block a shipment. `guessed` does not: the value was
 * inferred and is probably right, but is worth a glance.
 */
export interface AddressIssue {
  field: AddressField | "country";
  code: "missing" | "invalid" | "guessed" | "not_thailand";
}

export interface ParsedAddress {
  address: Address;
  issues: AddressIssue[];
}

/** True when nothing in `issues` stops the address from being shipped to. */
export function isShippable(issues: readonly AddressIssue[]): boolean {
  return issues.every((issue) => issue.code === "guessed");
}

const SUBDISTRICT = new Set(["ตำบล", "แขวง", "ต."]);
const DISTRICT = new Set(["อำเภอ", "เขต", "อ."]);
const PROVINCE = new Set(["จังหวัด", "จ."]);

// Customers often type the parts with no spaces ("ต.สุเทพอ.เมืองจ.เชียงใหม่"),
// so the abbreviations and the long words may follow anything but a Latin
// letter or a dot. "เขต" also occurs inside words, so it needs a boundary.
const MARKER = /(?:(?<![A-Za-z.])(ตำบล|แขวง|อำเภอ|จังหวัด|ต\.|อ\.|จ\.)|(?<=^|[\s,(\d])(เขต))\s*/g;
const ZIP = /(?<!\d)(\d{5})(?!\d)/g;

const clean = (text: string | null | undefined): string =>
  (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

const tidy = (text: string): string =>
  text
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");

const stripDistrictPrefix = (text: string): string => text.replace(/^(อำเภอ|เขต|อ\.)\s*/, "").trim();

const isThaiWord = (text: string): boolean => /^[฀-๿]+$/.test(text);

/** A Thai phone number in its domestic form, "0812345678". */
export function normalizePhone(phone: string | null | undefined): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length === 11) digits = "0" + digits.slice(2);
  if (digits.length === 9 && !digits.startsWith("0")) digits = "0" + digits;
  return digits;
}

/** "เมือง" alone means the province's capital district, "เมืองเชียงใหม่". */
function expandMueang(district: string, province: string): string {
  if (province && province !== BANGKOK && /^(เมือง|mueang|muang)$/i.test(district)) {
    return "เมือง" + province;
  }
  return district;
}

/**
 * Splits a platform address into the fields iShip needs.
 *
 * It reads ตำบล/แขวง, อำเภอ/เขต and จังหวัด markers out of the address lines,
 * falls back to `city` for the district and to the province code or name for
 * the province, and reports every field it could not fill.
 */
export function parseThaiAddress(raw: RawAddress): ParsedAddress {
  const issues: AddressIssue[] = [];

  const country = clean(raw.countryCode).toUpperCase();
  if (country && country !== "TH") issues.push({ field: "country", code: "not_thailand" });

  const line1 = clean(raw.line1);
  const line2 = clean(raw.line2);
  const text = [line1, line2].filter(Boolean).join(" ");

  // Pull "marker value" pairs out of the text, keeping the rest as the street.
  let subdistrict = "";
  let district = "";
  let provinceText = "";
  const street: string[] = [];

  const markers = [...text.matchAll(MARKER)];
  street.push(text.slice(0, markers[0]?.index ?? text.length));

  markers.forEach((match, i) => {
    const start = match.index! + match[0].length;
    const end = markers[i + 1]?.index ?? text.length;
    const segment = text.slice(start, end).trim();

    const [first = "", ...rest] = segment.split(/[\s,]+/);
    const value = first.replace(/\d+$/, "").replace(/[.,;:]+$/, "");
    const leftover = (first.slice(value.length) + " " + rest.join(" ")).trim();

    const marker = match[1] ?? match[2];
    if (SUBDISTRICT.has(marker) && !subdistrict) subdistrict = value;
    else if (DISTRICT.has(marker) && !district) district = value;
    else if (PROVINCE.has(marker) && !provinceText) provinceText = value;
    else street.push(match[0] + segment);

    if (leftover) street.push(leftover);
  });

  // Province: a code beats a name, and either beats what the lines say.
  const province =
    thaiProvince(raw.provinceCode) ??
    thaiProvince(raw.province) ??
    thaiProvince(provinceText) ??
    thaiProvince(clean(raw.city)) ??
    "";
  if (!province) issues.push({ field: "province", code: "missing" });

  // Postcode: the field, or the last five-digit number in the lines.
  let zipcode = clean(raw.zip).replace(/\D/g, "");
  const zipsInText = [...text.matchAll(ZIP)].map((m) => m[1]);
  if (!zipcode && zipsInText.length) zipcode = zipsInText[zipsInText.length - 1];
  if (!zipcode) issues.push({ field: "zipcode", code: "missing" });
  else if (!/^\d{5}$/.test(zipcode)) issues.push({ field: "zipcode", code: "invalid" });

  // District: the marker, otherwise `city` unless it only names the province.
  const city = stripDistrictPrefix(clean(raw.city));
  if (!district && city && thaiProvince(city) === undefined) district = city;
  district = expandMueang(district, province);
  if (!district) issues.push({ field: "district", code: "missing" });

  // Subdistrict: the marker, otherwise a lone Thai word on line 2.
  let streetParts = street;
  if (!subdistrict && line2 && isThaiWord(line2) && line2 !== district && thaiProvince(line2) === undefined) {
    subdistrict = line2;
    streetParts = [line1];
    issues.push({ field: "subdistrict", code: "guessed" });
  }
  if (!subdistrict) issues.push({ field: "subdistrict", code: "missing" });

  // Street: whatever is left once the parts above and the postcode are removed.
  const address = tidy(
    streetParts
      .join(" ")
      .split(/\s+/)
      .filter((word) => {
        const bare = word.replace(/[,]/g, "");
        if (bare === zipcode) return false;
        if (province && thaiProvince(bare) === province) return false;
        return true;
      })
      .join(" "),
  );
  if (!address) issues.push({ field: "address", code: "missing" });

  const name = clean(raw.name);
  if (!name) issues.push({ field: "name", code: "missing" });

  const phone = normalizePhone(raw.phone);
  if (!phone) issues.push({ field: "phone", code: "missing" });
  else if (!/^0\d{8,9}$/.test(phone)) issues.push({ field: "phone", code: "invalid" });

  return {
    address: { name, phone, address, subdistrict, district, province, zipcode },
    issues,
  };
}

/**
 * Applies a person's corrections on top of a parsed address and re-checks it.
 * Empty strings in `overrides` are ignored, so a form can send every field.
 */
export function applyOverrides(parsed: ParsedAddress, overrides: Partial<Address> | null | undefined): ParsedAddress {
  if (!overrides) return parsed;

  const address = { ...parsed.address };
  const touched = new Set<AddressField>();
  for (const [field, value] of Object.entries(overrides) as [AddressField, string | undefined][]) {
    const text = clean(value);
    if (!text) continue;
    address[field] = field === "phone" ? normalizePhone(text) : field === "province" ? (thaiProvince(text) ?? text) : text;
    touched.add(field);
  }

  const issues = parsed.issues.filter((issue) => issue.field === "country" || !touched.has(issue.field));
  for (const field of touched) {
    if (field === "phone" && !/^0\d{8,9}$/.test(address.phone)) issues.push({ field, code: "invalid" });
    if (field === "zipcode" && !/^\d{5}$/.test(address.zipcode)) issues.push({ field, code: "invalid" });
    if (field === "province" && thaiProvince(address.province) === undefined) issues.push({ field, code: "invalid" });
  }
  return { address, issues };
}
