// The invoice's amount in words (docs/decisions/0009-visa-invoice.md Decision 7), in Indian numbering: crore, lakh,
// thousand, hundred. "Four Thousand Rupees", "One Lakh Twenty Three Thousand Rupees and Fifty Paise".

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 1–99 */
function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const ones = n % 10;
  return TENS[Math.floor(n / 10)]! + (ones ? ` ${ONES[ones]}` : "");
}

/** 1–999 */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** A whole number of rupees in words, Indian style. 0 is "Zero". */
export function numberInWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** An amount in paise, in words: "Thirteen Thousand Five Hundred Rupees", "… Rupees and Fifty Paise". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const words = `${numberInWords(rupees)} ${rupees === 1 ? "Rupee" : "Rupees"}`;
  return rest ? `${words} and ${belowHundred(rest)} Paise` : words;
}
