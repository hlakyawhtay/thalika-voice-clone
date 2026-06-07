const myanmarDigitMap: Record<string, string> = {
  "၀": "0",
  "၁": "1",
  "၂": "2",
  "၃": "3",
  "၄": "4",
  "၅": "5",
  "၆": "6",
  "၇": "7",
  "၈": "8",
  "၉": "9"
};

const digitWords = ["သုည", "တစ်", "နှစ်", "သုံး", "လေး", "ငါး", "ခြောက်", "ခုနစ်", "ရှစ်", "ကိုး"];

const placeWords: Record<number, { normal: string; beforeLower?: string }> = {
  1: { normal: "ဆယ်", beforeLower: "ဆယ့်" },
  2: { normal: "ရာ", beforeLower: "ရာ့" },
  3: { normal: "ထောင်", beforeLower: "ထောင့်" },
  4: { normal: "သောင်း" },
  5: { normal: "သိန်း" },
  6: { normal: "သန်း" }
};

export interface BurmeseNumberSpelloutChange {
  source: string;
  spoken: string;
}

function toAsciiDigits(value: string) {
  return value.replace(/[၀-၉]/gu, (digit) => myanmarDigitMap[digit] || digit);
}

function hasNonZeroAfter(digits: string, index: number) {
  return /[1-9]/.test(digits.slice(index + 1));
}

function isLetterOrMark(value: string) {
  return Boolean(value) && /[\p{L}\p{M}_]/u.test(value);
}

function touchesNumericSeparator(previous: string, next: string) {
  return /[./:+\-]/.test(previous) || /[./:+\-]/.test(next);
}

function isValidIntegerToken(token: string) {
  if (/^\d+$/u.test(token)) return true;
  return /^\d{1,3}(,\d{3})+$/u.test(token);
}

function shouldSkipIntegerToken(token: string, previous: string, next: string) {
  const asciiToken = toAsciiDigits(token);
  if (!isValidIntegerToken(asciiToken)) return true;
  const digits = asciiToken.replace(/,/g, "");

  if (digits.length > 1 && digits.startsWith("0")) return true;
  if (digits.length > 7) return true;
  if (isLetterOrMark(previous) || isLetterOrMark(next)) return true;
  if (/[0-9၀-၉,]/u.test(previous) || /[0-9၀-၉,]/u.test(next)) return true;
  return touchesNumericSeparator(previous, next);
}

export function spelloutBurmeseNumberToken(token: string) {
  const digits = toAsciiDigits(token).replace(/,/g, "");
  if (!/^\d{1,7}$/u.test(digits)) return undefined;
  if (digits.length > 1 && digits.startsWith("0")) return undefined;
  if (digits === "0") return digitWords[0];

  const parts: string[] = [];
  const characters = [...digits];

  characters.forEach((digit, index) => {
    if (digit === "0") return;

    const numericDigit = Number(digit);
    const power = characters.length - index - 1;

    if (power === 0) {
      parts.push(digitWords[numericDigit]);
      return;
    }

    const place = placeWords[power];
    if (!place) {
      parts.length = 0;
      return;
    }

    const lowerExists = hasNonZeroAfter(digits, index);
    const placeWord = lowerExists && place.beforeLower ? place.beforeLower : place.normal;
    const prefix = power === 3 && numericDigit === 1 && lowerExists ? "" : digitWords[numericDigit];
    const word = `${prefix}${placeWord}`;

    if (power === 1 && characters[index + 1] === "0" && parts.length > 0) {
      parts.push(` ${word}`);
      return;
    }

    parts.push(word);
  });

  return parts.join("");
}

export function expandBurmeseNumberTokens(script: string) {
  const changes: BurmeseNumberSpelloutChange[] = [];
  const normalizedScript = script.replace(/[0-9၀-၉][0-9၀-၉,]*/gu, (source, offset: number, fullText: string) => {
    const previous = offset > 0 ? fullText[offset - 1] || "" : "";
    const nextIndex = offset + source.length;
    const next = nextIndex < fullText.length ? fullText[nextIndex] || "" : "";

    if (shouldSkipIntegerToken(source, previous, next)) return source;

    const spoken = spelloutBurmeseNumberToken(source);
    if (!spoken) return source;

    changes.push({ source, spoken });
    return spoken;
  });

  return { normalizedScript, changes };
}
