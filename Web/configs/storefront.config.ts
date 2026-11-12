import { getCachedSetting } from "./setting.config";

// Look and locale of the store, edited in Settings > Storefront. Missing fields fall back to these
// defaults, so a fresh database behaves like the original Vietnamese store.
export interface StorefrontSettings {
  primaryColor: string;
  secondaryColor: string;
  /** Google Fonts family names; empty keeps the theme's fonts */
  headingFont: string;
  bodyFont: string;
  /** ISO 4217 code prices are entered, stored and charged in; chosen once when the store is set up */
  currency: string;
  /** Currencies shoppers may view prices in (converted with live rates, for reference only) */
  displayCurrencies: string[];
  /** BCP 47 locale for numbers and dates, e.g. vi-VN, en-US */
  locale: string;
  /** IANA time zone for reports, order dates and "today" */
  timezone: string;
  /** html lang attribute of the storefront */
  language: string;
  /** Order value that earns one loyalty point */
  moneyPerPoint: number;
  /** Discount one loyalty point is worth at checkout */
  pointValue: number;
  /** Promises listed beside every product, one per line as "Text" or "Text | /link"; empty hides the box */
  productPromises: string;
  /** "logo" shows the logo image only; "logo-name" also writes the store name beside it */
  logoDisplay: "logo" | "logo-name";
}

export interface ProductPromise {
  text: string;
  href: string;
}

export const STOREFRONT_DEFAULTS: StorefrontSettings = {
  primaryColor: "#1C1917",
  secondaryColor: "#A16207",
  headingFont: "",
  bodyFont: "",
  currency: "VND",
  displayCurrencies: ["VND", "USD", "EUR", "JPY", "GBP", "CNY"],
  locale: "vi-VN",
  timezone: "Asia/Ho_Chi_Minh",
  language: "en",
  moneyPerPoint: 10000,
  pointValue: 100,
  productPromises: "Returns within 30 days of delivery | /return-policy\nFree exchange for defective or damaged items | /return-policy",
  logoDisplay: "logo",
};

let current: StorefrontSettings = { ...STOREFRONT_DEFAULTS };

const pick = <T>(value: T | undefined | null | "", fallback: T): T =>
  value === undefined || value === null || value === "" ? fallback : value;

// Display currencies as saved (a list) or typed in the settings form ("USD, EUR"): upper-cased, without blanks.
export const parseCurrencyList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean);

export const normalizeStorefront = (data: Partial<StorefrontSettings> | undefined): StorefrontSettings => {
  const d = data || {};
  const positive = (value: unknown, fallback: number) => (Number(value) > 0 ? Number(value) : fallback);
  const currency = pick(d.currency, STOREFRONT_DEFAULTS.currency).toUpperCase();
  const display = d.displayCurrencies === undefined || d.displayCurrencies === null
    ? STOREFRONT_DEFAULTS.displayCurrencies
    : parseCurrencyList(d.displayCurrencies);
  return {
    primaryColor: pick(d.primaryColor, STOREFRONT_DEFAULTS.primaryColor),
    secondaryColor: pick(d.secondaryColor, STOREFRONT_DEFAULTS.secondaryColor),
    headingFont: pick(d.headingFont, STOREFRONT_DEFAULTS.headingFont),
    bodyFont: pick(d.bodyFont, STOREFRONT_DEFAULTS.bodyFont),
    currency,
    // The store currency always comes first, so shoppers can switch back to it.
    displayCurrencies: [...new Set([currency, ...display])],
    locale: pick(d.locale, STOREFRONT_DEFAULTS.locale),
    timezone: pick(d.timezone, STOREFRONT_DEFAULTS.timezone),
    language: pick(d.language, STOREFRONT_DEFAULTS.language),
    moneyPerPoint: positive(d.moneyPerPoint, STOREFRONT_DEFAULTS.moneyPerPoint),
    pointValue: positive(d.pointValue, STOREFRONT_DEFAULTS.pointValue),
    // Saved empty on purpose hides the promises, so only a missing field falls back to the defaults.
    productPromises: typeof d.productPromises === "string" ? d.productPromises : STOREFRONT_DEFAULTS.productPromises,
    logoDisplay: d.logoDisplay === "logo-name" ? "logo-name" : "logo",
  };
};

// The promise lines as text and an optional same-site link ("/return-policy") or http(s) URL.
export const parseProductPromises = (value: string): ProductPromise[] =>
  value
    .split("\n")
    .map((line) => {
      const [text, link = ""] = line.split("|").map((part) => part.trim());
      const href = /^(\/(?!\/)|https?:\/\/)/.test(link) ? link : "";
      return { text, href };
    })
    .filter((promise) => promise.text);

// Synchronous read for formatters and templates; refreshed by loadStorefront().
export const getStorefront = (): StorefrontSettings => current;

// Reads the (cached) setting and makes it current. Called per request, at startup and by jobs.
export const loadStorefront = async (): Promise<StorefrontSettings> => {
  current = normalizeStorefront(await getCachedSetting<Partial<StorefrontSettings>>("storefront"));
  return current;
};

// Decimal places of the store currency (VND 0, USD 2, ...).
export const currencyDigits = (currency = current.currency): number => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

// A price entered by staff, rounded to the currency's decimals; invalid or negative input is 0.
export const toMoney = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  const factor = 10 ** currencyDigits();
  return Math.round(parsed * factor) / factor;
};
