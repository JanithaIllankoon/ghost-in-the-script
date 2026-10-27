// Turns "2024" or "15" in a script into the words people actually say,
// so voice tracking can match them.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) {
    out.push(ONES[Math.floor(n / 100)], "hundred");
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n) out.push(ONES[n]);
  } else if (n > 0 || out.length === 0) {
    out.push(ONES[n]);
  }
  return out;
}

export function numberToWords(n: number): string[] {
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999) return [];
  n = Math.floor(n);
  // Years like 1990 or 2024 are usually said as "nineteen ninety" / "twenty twenty four".
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  const yearLike = n >= 1100 && n <= 2099 && (lo >= 10 || hi % 10 !== 0);
  if (yearLike) {
    if (lo === 0) return [...under1000(hi), "hundred"];
    return [...under1000(hi), ...(lo < 10 ? ["oh", ONES[lo]] : under1000(lo))];
  }
  if (n === 0) return ["zero"];
  const out: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions) out.push(...under1000(millions), "million");
  if (thousands) out.push(...under1000(thousands), "thousand");
  if (rest) out.push(...under1000(rest));
  return out;
}
