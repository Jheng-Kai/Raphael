/**
 * Slime faces that were renamed. A face is `slime:<id>`; twenty-four of them were renamed to say what they look like,
 * and a face stored or sent under an old id (a member's stored face, a catalogue entry, a draft that names one) must
 * still be drawn. The old ids are kept only as SHA-256 digests, so nothing in the repository spells them: the id is
 * hashed and looked up. The core keeps the same table (`core/src/raphael_core/slime_ids.py`, the only place that
 * rewrites what is stored); slime-ids.test.ts holds the two equal.
 */

/** sha256(retired id) -> the id the face has now. */
export const RETIRED_SLIME_IDS: Readonly<Record<string, string>> = {
  "ef8e0d4de84e5a576c88f69049af41c93c27a59455089b2b69e9c4c3767ec00a": "blue-plain",
  "dd2d8c67929c0f9ff86e7cdd37a65efe4cf07bbf94f2b2703efb47340dc00cd8": "horn-lavender",
  "8c649a8f85f3d89d4eba2cf885e7f9273c9672b73eaf3ce43c5ea038ca648f0f": "streaks-charcoal",
  "a89526be62a24aa308ea85d04225e1568bb9a5cbc64d140d88608439187463d0": "horns-red",
  "3809eaefc6e3c5d67af829d39a09acc271cd4fcef4c4c8abdd28b2d846e7993e": "small-horns-pink",
  "64e3541b3b2483dd0eaf9c51e8aff4f5aa36a1567369eed67eca041bed80ddb2": "horn-sash-blue",
  "304544a979deb561ff2114943f9d3673cfe3fdb35ee59b45e407c5f5ddb6580e": "mustache-gray",
  "2873be4655e5ea947eedd3fb774cb18980403eb9cc4f358b7e8dbbe9cbad1c86": "goggles-green",
  "0500be407557a859fd7ddc4d0b7e099200d36f770b9d06176a62496564aa3a17": "cap-green",
  "8491791106f1faf0f9d07aafb377bf57cb0622a7b049fefffcc4cbefe72f99cb": "bowtie-green",
  "c2b2cee73ea10377f07c4899069cf1ec6448d5b952cf10edb6372e128f9b2923": "tuft-pink",
  "bf618dab305c69ea27212ab85cc79fbd345d891c266277c826d6c3611e65b9f9": "horns-blue",
  "0e1b1d99008708e06880fa6dacbc82038d03d47b7d372d51adb92b6c2fd77ec8": "wolf-star",
  "348d1d93a5134abac6b29dff548f3d4f73e4aeb0e2a57de1cee78e511b927d3c": "frill-periwinkle",
  "086325a3ff8409072bbbfbcb478e974c5240d29dceedd7175ae69cb6f2595076": "tusks-tan",
  "7e00043caa7b2838de345435465c30a516ec7e2a68499842b12876f5ac578668": "sprout-mint",
  "51e83e5669dd835a2f18ec7929d396a516c6f8840a7cc27f927e28ab046d45c4": "headband-brown",
  "24fff5ac76bc4bd7dfd05147ff0a345c24436b59d83f6909eb7ee42c30ec6bda": "mask-cornflower",
  "3000caca5b94c7e5fc0f9e2f187bb589f925597778832ad59485280ac32be4c1": "collar-indigo",
  "3379feb6ae9fed3b989470c591c5aa7ec00269580b84f1737c9e63202645e4b2": "sash-crimson",
  "363554e2e3d91266fbc6000cffb52f8d33b38aeccf47698e87fb465bd150937d": "bowtie-pearl",
  "3f4aba76661a2088d9f97598515cfc9350da9005fc3c6e2a179e18f6c0c19751": "bowtie-purple",
  "9e334420f8c18aa18343c5178448e91b302147a4bcfae6e8178f1e15e4bc481f": "necktie-amber",
  "bc7f3b64af0ed4bbea4497ae5823c2216a973e46f5b43d5fc68b85c3bdf793a6": "wings-yellow",
};

/** Costumes of the first builds that later became characters. */
export const LEGACY_SLIME_IDS: ReadonlyMap<string, string> = new Map([["oni", "horn-lavender"], ["demon", "streaks-charcoal"]]);

// The constants of the hash are the fractional parts of the roots of the first primes.
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every(prime => n % prime)) PRIMES.push(n);
const K = PRIMES.map(prime => Math.floor((Math.cbrt(prime) % 1) * 4294967296) | 0);
const H0 = PRIMES.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 4294967296) | 0);
const ror = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

/** SHA-256 of the UTF-8 text, as 64 hex digits: a face is looked up while a picture is drawn, so it cannot wait for `crypto.subtle`. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 4294967296));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const hash = [...H0], w = new Int32Array(64);
  for (let start = 0; start < padded.length; start += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(start + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[i - 7]! + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const first = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const second = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i]! + value) | 0; });
  }
  return hash.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

const looked = new Map<string, string>();

/** The id a face has now: a retired id (or an old costume name) is renamed, any other comes back as it was. */
export function currentSlimeId(id: string): string {
  const legacy = LEGACY_SLIME_IDS.get(id);
  if (legacy !== undefined) return legacy;
  let digest = looked.get(id);
  if (digest === undefined) {
    if (looked.size >= 512) looked.clear();
    digest = sha256Hex(id);
    looked.set(id, digest);
  }
  return Object.prototype.hasOwnProperty.call(RETIRED_SLIME_IDS, digest) ? RETIRED_SLIME_IDS[digest]! : id;
}
