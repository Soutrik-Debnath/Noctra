/**
 * Romanisation for Indic lyrics — Hindi, Bengali, Punjabi and Gujarati.
 *
 * Why this exists locally rather than fetched: LRCLIB has no romanised field, and the sites that do
 * are exactly the un-API'd scrapers the spec rules out. Indic-to-Latin is different — these are
 * *scripts*, not languages, so a rule-based transliteration is deterministic, offline, and costs
 * nothing per line.
 *
 * Deliberately ASCII-only ("khwabon", not "khwābon"). The point is singing along, not linguistics,
 * and macrons make the text harder to scan at a glance.
 *
 * SCOPE, and what is deliberately left out
 * -----------------------------------------
 * Every script handled here descends from Brahmi and shares the same machinery, which is what makes
 * one engine cover four of them: a bare consonant carries an inherent vowel, a matra replaces it, a
 * halant kills it, and an anusvara/visarga tail the syllable. The tables differ; the state machine
 * does not.
 *
 * The Unicode blocks are *nearly* parallel — Bengali sits exactly Devanagari + 0x80 — but not
 * exactly. Checked empirically before writing this: Gurmukhi, Odia and the Dravidian blocks each
 * break the offset at one or more positions, because a script has merged, dropped or reordered a
 * letter. Tamil is short a whole column (no झ/ञ series). So a blind offset remap from Devanagari
 * would silently produce wrong letters, and every table below is written out explicitly instead.
 *
 * What is deliberately left out
 * -----------------------------
 * Not attempted: Tamil, Telugu, Kannada, Malayalam, Japanese, Korean. The Dravidian scripts have
 * retroflex series and vowel behaviours that need their own verified tables rather than a guess, and
 * for Japanese and Korean the reading is ambiguous without a dictionary. In all of these a *wrong*
 * romanisation is worse than none, because it teaches the wrong words.
 *
 * Why the nukta letters are written as escapes
 * --------------------------------------------
 * Every one of these has two Unicode spellings that render identically: precomposed (ज़ as U+095B)
 * and decomposed (ज U+091C + nukta U+093C). They are *not* canonical equivalents, so neither
 * `normalize("NFC")` nor `normalize("NFD")` converts between them and no normalisation pass will ever
 * reconcile the two. Typing the literal is a coin flip, and if it lands on the decomposed side the
 * entry becomes a two-codepoint key in a table that is looked up one codepoint at a time — a dead
 * entry that fails silently. Real lyric files in this library use both forms. So the composed letters
 * are escapes, and each table also carries its own nukta plus the base letters it modifies, which
 * covers the decomposed spelling wherever it turns up. `romanize.test.ts` pins both spellings of
 * every one of these letters for exactly that reason.
 */

type Table = {
  vowels: Record<string, string>;
  /** Combining marks that replace a consonant's inherent vowel. */
  matras: Record<string, string>;
  consonants: Record<string, string>;
  /** Anusvara, visarga, candrabindu, danda. */
  tail: Record<string, string>;
  digits: Record<string, string>;
  halant: string;
  /** The vowel a bare consonant carries. Devanagari and Gurmukhi "a"; Bengali "o". */
  inherent: string;
  nukta?: string;
  nuqtaLetters?: Record<string, string>;
};

const DEVANAGARI: Table = {
  vowels: {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
    "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऍ": "ae", "ऑ": "o",
    // ॐ is a syllable in its own right, not a consonant, so it gets no inherent vowel.
    "ॐ": "om",
  },
  /*
     Shorter than the standalone vowels on purpose. Hindi writes a long vowel where the romanisation
     people actually read has a short one — "हम्मा" is "hamma", not "hammaa", and "बिना" is "bina".
     Matching the letters a singer would use beats matching the phonology.
  */
  matras: {
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "ae", "ॉ": "o",
  },
  consonants: {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    // The nukta letters, precomposed spelling. Same readings as `nuqtaLetters` below.
    "\u0958": "q", "\u0959": "kh", "\u095A": "g", "\u095B": "z",
    "\u095C": "r", "\u095D": "rh", "\u095E": "f", "\u095F": "y",
  },
  tail: { "ं": "n", "ँ": "n", "ः": "h", "ऽ": "'", "।": ".", "॥": "." },
  digits: {
    "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
    "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  },
  halant: "्",
  inherent: "a",
  nukta: "़",
  nuqtaLetters: {
    "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y", "ल": "l",
  },
};

const BENGALI: Table = {
  vowels: {
    "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u",
    "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
  },
  // "কার" is heard as /ɔ/, so a bare ক is "ko" — the reason Bengali needs its own `inherent`.
  matras: {
    "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
    "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
  },
  consonants: {
    "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
    "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "ny",
    "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "nn",
    "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
    "প": "p", "ফ": "ph", "ব": "b", "ভ": "bh", "ম": "m",
    "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh", "স": "sh", "হ": "h",
    // ড়, ঢ় and য় carry a nukta; precomposed spelling first, then the base letters it folds onto.
    "\u09DC": "r", "\u09DD": "rh", "\u09DF": "y",
  },
  tail: { "ং": "n", "ঃ": "h", "ঁ": "n", "।": ".", "॥": "." },
  digits: {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  },
  halant: "্",
  inherent: "o",
  nukta: "\u09BC",
  nuqtaLetters: { "\u09A1": "r", "\u09A2": "rh", "\u09AF": "y" },
};

const GURMUKHI: Table = {
  vowels: {
    "ਅ": "a", "ਆ": "aa", "ਇ": "i", "ਈ": "ee", "ਉ": "u", "ਊ": "oo",
    "ਏ": "e", "ਐ": "ai", "ਓ": "o", "ੌ": "au",
    "\u0A14": "o",
  },
  matras: { "ਾ": "a", "ਿ": "i", "ੀ": "i", "ੁ": "u", "ੂ": "u", "ੇ": "e", "ੈ": "ai", "ੋ": "o", "ੌ": "au" },
  consonants: {
    "ਕ": "k", "ਖ": "kh", "ਗ": "g", "ਘ": "gh", "ਙ": "n",
    "ਚ": "ch", "ਛ": "chh", "ਜ": "j", "ਝ": "jh", "ਞ": "ny",
    "ਟ": "t", "ਠ": "th", "ਡ": "d", "ਢ": "dh", "ਣ": "n",
    "ਤ": "t", "ਥ": "th", "ਦ": "d", "ਧ": "dh", "ਨ": "n",
    "ਪ": "p", "ਫ": "ph", "ਬ": "b", "ਭ": "bh", "ਮ": "m",
    "ਯ": "y", "ਰ": "r", "ਲ": "l", "ਵ": "v", "ੜ": "r",
    "ਸ": "s", "ਹ": "h",
    // These five are single codepoints in Unicode, not ਸ+ਨੁਕਤਾ sequences, so they need their own rows.
    "\u0A36": "sh", "\u0A59": "kh", "\u0A5A": "gh", "\u0A5B": "z", "\u0A5E": "f", "\u0A33": "l",
  },
  tail: { "ਂ": "n", "\u0A70": "n", "ੱ": "a", "ਃ": "h", "।": "." },
  digits: {
    "੦": "0", "੧": "1", "੨": "2", "੩": "3", "੪": "4",
    "੫": "5", "੬": "6", "੭": "7", "੮": "8", "੯": "9",
  },
  halant: "੍",
  inherent: "a",
  nukta: "\u0A3C",
  nuqtaLetters: {
    "\u0A38": "sh", "\u0A16": "kh", "\u0A17": "gh", "\u0A1C": "z", "\u0A2B": "f", "\u0A32": "l",
  },
};

const GUJARATI: Table = {
  vowels: {
    "અ": "a", "આ": "aa", "ઇ": "i", "ઈ": "ee", "ઉ": "u", "ઊ": "oo",
    "ઋ": "ri", "એ": "e", "ઐ": "ai", "ઓ": "o", "ઔ": "au",
  },
  matras: {
    "ા": "a", "િ": "i", "ી": "i", "ુ": "u", "ૂ": "u", "ૃ": "ri",
    "ે": "e", "ૈ": "ai", "ો": "o", "ૌ": "au",
  },
  consonants: {
    "ક": "k", "ખ": "kh", "ગ": "g", "ઘ": "gh", "ઙ": "n",
    "ચ": "ch", "છ": "chh", "જ": "j", "ઝ": "jh", "ઞ": "ny",
    "ટ": "t", "ઠ": "th", "ડ": "d", "ઢ": "dh", "ણ": "n",
    "ત": "t", "થ": "th", "દ": "d", "ધ": "dh", "ન": "n",
    "પ": "p", "ફ": "ph", "બ": "b", "ભ": "bh", "મ": "m",
    "ય": "y", "ર": "r", "લ": "l", "ળ": "l", "વ": "v",
    "શ": "sh", "ષ": "sh", "સ": "s", "હ": "h",
  },
  tail: { "ં": "n", "ઃ": "h", "ઽ": "'", "।": "." },
  digits: {
    "૦": "0", "૧": "1", "૨": "2", "૩": "3", "૪": "4",
    "૫": "5", "૬": "6", "૭": "7", "૮": "8", "૯": "9",
  },
  halant: "્",
  inherent: "a",
};

const SCRIPTS: Table[] = [DEVANAGARI, BENGALI, GURMUKHI, GUJARATI];

/**
 * Halant-then-nukta rewritten as nukta-then-halant, for the scripts that use the dot.
 *
 * "ख़्वाहिश" is filed as ख + halant + nukta, with the dot sitting *outside* the cluster marker even
 * though it belongs to the consonant. The fold below reads the dot as the consonant's immediate
 * neighbour, so the pair is swapped first rather than special-cased in the state machine. A nukta can
 * never modify a halant, so reordering is a correction, not a guess.
 */
const MISPLACED_NUKTA: [string, string][] = SCRIPTS.filter((t) => t.nukta).map(
  (t) => [t.halant + t.nukta!, t.nukta! + t.halant],
);

/** Every character any table knows, mapped back to the table that owns it. */
const OWNER = new Map<string, Table>();
for (const t of SCRIPTS) {
  for (const group of [t.vowels, t.matras, t.consonants, t.tail, t.digits]) {
    for (const ch of Object.keys(group)) OWNER.set(ch, t);
  }
  OWNER.set(t.halant, t);
  if (t.nukta) OWNER.set(t.nukta, t);
}

/** True when a string has enough Indic script in it to be worth romanising. */
export function needsRomanisation(text: string): boolean {
  let hit = 0;
  for (const ch of text) if (OWNER.has(ch)) hit++;
  return hit / Math.max(1, [...text].length) > 0.15;
}

/**
 * Transliterate one Indic string to ASCII.
 *
 * The rule that makes or breaks the result is the inherent vowel: a bare consonant carries it unless a
 * matra replaces it or a halant kills it. Hindi and Punjabi then *drop* it again at the end of a word —
 * "भोलेनाथ" is "bholenath", not "bholenatha", and "ਹਮ" is "ham", not "hama" — so a pending vowel is
 * discarded at a word boundary rather than written out. Bengali keeps its "o" ("কামনা" is "komona"),
 * which is why the value is per-table rather than hardcoded.
 */
export function romanise(text: string): string {
  for (const [from, to] of MISPLACED_NUKTA) text = text.replaceAll(from, to);
  const chars = [...text];
  // The dominant script for this string decides the table, so a Hindi line quoted inside a Bengali
  // one cannot have its consonants read with the wrong inherent vowel.
  const tally = new Map<Table, number>();
  for (const ch of chars) {
    const t = OWNER.get(ch);
    if (t) tally.set(t, (tally.get(t) ?? 0) + 1);
  }
  let table: Table | undefined;
  let best = 0;
  for (const [t, n] of tally) if (n > best) { best = n; table = t; }
  if (!table) return text;

  const halants = new Set(SCRIPTS.map((s) => s.halant));
  const isWordBoundary = (ch: string) => /[\s(),.\-–:;"’]/u.test(ch);

  let out = "";
  let pending = "";
  const emit = () => { out += pending; pending = ""; };
  const drop = () => { pending = ""; };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    // Resolve the letter against whichever table owns it, falling back to the dominant one for a
    // shared mark like a matra that is identical in more than one script.
    const own: Table = OWNER.get(ch) ?? table;

    if (ch === table.halant || (halants.has(ch) && own === table)) {
      // Swallow the inherent vowel so the next consonant joins it as a cluster.
      drop();
      continue;
    }

    const matra = own.matras[ch] ?? table.matras[ch];
    if (matra) { out += matra; pending = ""; continue; }

    const cons = own.consonants[ch];
    if (cons) {
      // Resolve a following nukta here rather than in its own branch: the dot modifies the letter
      // that has not been written yet, so peeking forward avoids having to rewrite `out`.
      let value = cons;
      if (table.nukta && chars[i + 1] === table.nukta) {
        value = table.nuqtaLetters?.[ch] ?? cons;
        i++;
      }
      emit();
      out += value;
      pending = table.inherent;
      continue;
    }

    const vowel = own.vowels[ch] ?? table.vowels[ch];
    if (vowel) { emit(); out += vowel; continue; }

    if (ch in own.tail) { emit(); out += own.tail[ch]; continue; }
    if (ch in own.digits) { emit(); out += own.digits[ch]; continue; }

    // Latin, punctuation or whitespace. Any pending inherent vowel at a word end is silent.
    if (isWordBoundary(ch)) drop();
    else emit();
    out += ch;
  }

  drop();
  return out;
}
