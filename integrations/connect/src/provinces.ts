/**
 * Thailand's 77 provinces, keyed by their ISO 3166-2 code (the `TH-xx` codes
 * Shopify and most checkouts send as the province code).
 */
const PROVINCES: ReadonlyArray<readonly [code: string, thai: string, english: string]> = [
  ["10", "กรุงเทพมหานคร", "Bangkok"],
  ["11", "สมุทรปราการ", "Samut Prakan"],
  ["12", "นนทบุรี", "Nonthaburi"],
  ["13", "ปทุมธานี", "Pathum Thani"],
  ["14", "พระนครศรีอยุธยา", "Phra Nakhon Si Ayutthaya"],
  ["15", "อ่างทอง", "Ang Thong"],
  ["16", "ลพบุรี", "Lop Buri"],
  ["17", "สิงห์บุรี", "Sing Buri"],
  ["18", "ชัยนาท", "Chai Nat"],
  ["19", "สระบุรี", "Saraburi"],
  ["20", "ชลบุรี", "Chon Buri"],
  ["21", "ระยอง", "Rayong"],
  ["22", "จันทบุรี", "Chanthaburi"],
  ["23", "ตราด", "Trat"],
  ["24", "ฉะเชิงเทรา", "Chachoengsao"],
  ["25", "ปราจีนบุรี", "Prachin Buri"],
  ["26", "นครนายก", "Nakhon Nayok"],
  ["27", "สระแก้ว", "Sa Kaeo"],
  ["30", "นครราชสีมา", "Nakhon Ratchasima"],
  ["31", "บุรีรัมย์", "Buri Ram"],
  ["32", "สุรินทร์", "Surin"],
  ["33", "ศรีสะเกษ", "Si Sa Ket"],
  ["34", "อุบลราชธานี", "Ubon Ratchathani"],
  ["35", "ยโสธร", "Yasothon"],
  ["36", "ชัยภูมิ", "Chaiyaphum"],
  ["37", "อำนาจเจริญ", "Amnat Charoen"],
  ["38", "บึงกาฬ", "Bueng Kan"],
  ["39", "หนองบัวลำภู", "Nong Bua Lam Phu"],
  ["40", "ขอนแก่น", "Khon Kaen"],
  ["41", "อุดรธานี", "Udon Thani"],
  ["42", "เลย", "Loei"],
  ["43", "หนองคาย", "Nong Khai"],
  ["44", "มหาสารคาม", "Maha Sarakham"],
  ["45", "ร้อยเอ็ด", "Roi Et"],
  ["46", "กาฬสินธุ์", "Kalasin"],
  ["47", "สกลนคร", "Sakon Nakhon"],
  ["48", "นครพนม", "Nakhon Phanom"],
  ["49", "มุกดาหาร", "Mukdahan"],
  ["50", "เชียงใหม่", "Chiang Mai"],
  ["51", "ลำพูน", "Lamphun"],
  ["52", "ลำปาง", "Lampang"],
  ["53", "อุตรดิตถ์", "Uttaradit"],
  ["54", "แพร่", "Phrae"],
  ["55", "น่าน", "Nan"],
  ["56", "พะเยา", "Phayao"],
  ["57", "เชียงราย", "Chiang Rai"],
  ["58", "แม่ฮ่องสอน", "Mae Hong Son"],
  ["60", "นครสวรรค์", "Nakhon Sawan"],
  ["61", "อุทัยธานี", "Uthai Thani"],
  ["62", "กำแพงเพชร", "Kamphaeng Phet"],
  ["63", "ตาก", "Tak"],
  ["64", "สุโขทัย", "Sukhothai"],
  ["65", "พิษณุโลก", "Phitsanulok"],
  ["66", "พิจิตร", "Phichit"],
  ["67", "เพชรบูรณ์", "Phetchabun"],
  ["70", "ราชบุรี", "Ratchaburi"],
  ["71", "กาญจนบุรี", "Kanchanaburi"],
  ["72", "สุพรรณบุรี", "Suphan Buri"],
  ["73", "นครปฐม", "Nakhon Pathom"],
  ["74", "สมุทรสาคร", "Samut Sakhon"],
  ["75", "สมุทรสงคราม", "Samut Songkhram"],
  ["76", "เพชรบุรี", "Phetchaburi"],
  ["77", "ประจวบคีรีขันธ์", "Prachuap Khiri Khan"],
  ["80", "นครศรีธรรมราช", "Nakhon Si Thammarat"],
  ["81", "กระบี่", "Krabi"],
  ["82", "พังงา", "Phang Nga"],
  ["83", "ภูเก็ต", "Phuket"],
  ["84", "สุราษฎร์ธานี", "Surat Thani"],
  ["85", "ระนอง", "Ranong"],
  ["86", "ชุมพร", "Chumphon"],
  ["90", "สงขลา", "Songkhla"],
  ["91", "สตูล", "Satun"],
  ["92", "ตรัง", "Trang"],
  ["93", "พัทลุง", "Phatthalung"],
  ["94", "ปัตตานี", "Pattani"],
  ["95", "ยะลา", "Yala"],
  ["96", "นราธิวาส", "Narathiwat"],
];

export const BANGKOK = "กรุงเทพมหานคร";

/** Every province's Thai name, in ISO code order. */
export const THAI_PROVINCES: readonly string[] = PROVINCES.map(([, thai]) => thai);

const key = (text: string): string =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/^(จังหวัด|จ\.)\s*/, "")
    .replace(/(province|changwat)$/, "")
    .replace(/[\s\-.'’]/g, "");

const BY_KEY = new Map<string, string>();
const BY_CODE = new Map<string, string>();

for (const [code, thai, english] of PROVINCES) {
  BY_CODE.set(code, thai);
  BY_KEY.set(key(thai), thai);
  BY_KEY.set(key(english), thai);
}

const ALIASES: Record<string, string> = {
  "กทม": BANGKOK,
  "กรุงเทพ": BANGKOK,
  "กรุงเทพฯ": BANGKOK,
  "กรุงเทพมหานครฯ": BANGKOK,
  "krungthep": BANGKOK,
  "krungthepmahanakhon": BANGKOK,
  "bangkokmetropolis": BANGKOK,
  "อยุธยา": "พระนครศรีอยุธยา",
  "ayutthaya": "พระนครศรีอยุธยา",
  "korat": "นครราชสีมา",
  "โคราช": "นครราชสีมา",
  "bungkan": "บึงกาฬ",
  "nongbualamphu": "หนองบัวลำภู",
  "phangnga": "พังงา",
  "sisaket": "ศรีสะเกษ",
  "pattaya": "ชลบุรี",
};
for (const [alias, thai] of Object.entries(ALIASES)) BY_KEY.set(key(alias), thai);

/**
 * The official Thai name of a province, from a Thai or English name, an alias
 * such as "กทม", or an ISO code ("TH-50", "50"). Undefined when unrecognised.
 */
export function thaiProvince(nameOrCode: string | null | undefined): string | undefined {
  if (!nameOrCode) return undefined;
  const text = nameOrCode.trim();
  if (!text) return undefined;

  const code = /^(?:TH-?)?(\d{2}|S)$/i.exec(text);
  if (code) return code[1].toUpperCase() === "S" ? "ชลบุรี" : BY_CODE.get(code[1]);

  return BY_KEY.get(key(text));
}
