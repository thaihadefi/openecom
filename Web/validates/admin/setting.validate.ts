import { NextFunction, Request, Response } from "express";
import Joi from "joi";
import { PAYMENT_METHOD_IDS } from "../../configs/payment-methods.config";
import { isValidTimeZone } from "../../helpers/timezone.helper";
import { SOCIAL_LINKS } from "../../configs/social-links.config";
import { CONTENT_PAGES } from "../../configs/content-pages.config";
import { parseCurrencyList } from "../../configs/storefront.config";

const text = (max = 500) => Joi.string().trim().max(max).allow("");
// A non-negative number; an empty field clears it.
const amount = (max = 1e12) => Joi.alternatives().try(Joi.number().min(0).max(max), Joi.string().valid(""));
const hexColor = () => Joi.string().trim().pattern(/^#[0-9a-fA-F]{6}$/).messages({ "string.pattern.base": "Colors must look like #1C1917!" });
const fontName = () => Joi.string().trim().max(60).pattern(/^[A-Za-z0-9 ]*$/).allow("").messages({ "string.pattern.base": "Font names may contain letters, digits and spaces only!" });
const isCurrency = (code: string) => {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch {
    return false;
  }
};
const isLocale = (locale: string) => {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
};
const url = () => Joi.string().trim().uri({ scheme: ["http", "https"] }).max(500).allow("");

const schemas: Record<string, Joi.ObjectSchema> = {
  general: Joi.object({
    websiteName: text(100),
    domainWebsite: url(),
    logo: text(),
    favicon: text(),
    shopSenderName: text(100),
    shopSenderPhone: text(30),
    shopSenderAddress: text(300),
    contactEmail: Joi.string().trim().email({ tlds: { allow: false } }).max(254).allow(""),
    openingHours: text(200),
    shopLat: Joi.number().min(-90).max(90).allow(""),
    shopLng: Joi.number().min(-180).max(180).allow(""),
    storeDescription: text(300),
    ...Object.fromEntries(SOCIAL_LINKS.map((link) => [link.key, url()])),
  }),
  apiShipping: Joi.object({
    defaultItemWeight: amount(10000000),
    tokenGoShip: text(),
    goshipApiUrl: url(),
  }),
  apiPayment: Joi.object({
    zaloPayAppId: text(100),
    zaloPayKey1: text(),
    zaloPayKey2: text(),
    zaloPayDomain: url(),
    zaloPayEndpoint: url(),
    vnPayTmnCode: text(100),
    vnPayHashSecret: text(),
    vnPayURL: url(),
    enabledMethods: Joi.array().items(Joi.string().valid(...PAYMENT_METHOD_IDS)).unique(),
  }),
  storefront: Joi.object({
    primaryColor: hexColor(),
    secondaryColor: hexColor(),
    headingFont: fontName(),
    bodyFont: fontName(),
    currency: Joi.string().trim().uppercase().custom((value, helpers) => (isCurrency(value) ? value : helpers.error("any.invalid"))).messages({ "any.invalid": "Unknown currency code!" }),
    // A list, or the comma-separated text of the settings form.
    displayCurrencies: Joi.alternatives()
      .try(Joi.array().items(Joi.string()), Joi.string().allow(""))
      .custom((value, helpers) => {
        const codes = parseCurrencyList(value);
        return codes.every(isCurrency) ? [...new Set(codes)] : helpers.error("any.invalid");
      })
      .messages({ "any.invalid": "Display currencies must be ISO codes such as USD, EUR!" }),
    locale: Joi.string().trim().max(20).custom((value, helpers) => (isLocale(value) ? value : helpers.error("any.invalid"))).messages({ "any.invalid": "Unknown locale!" }),
    timezone: Joi.string().trim().max(60).custom((value, helpers) => (isValidTimeZone(value) ? value : helpers.error("any.invalid"))).messages({ "any.invalid": "Unknown time zone!" }),
    language: Joi.string().trim().pattern(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/).messages({ "string.pattern.base": "Language must be a code like en or vi!" }),
    moneyPerPoint: Joi.number().greater(0).max(1e12),
    pointValue: Joi.number().greater(0).max(1e12),
    productPromises: Joi.string().trim().max(2000).allow(""),
    logoDisplay: Joi.string().valid("logo", "logo-name"),
  }),
  pages: Joi.object(Object.fromEntries(CONTENT_PAGES.map((page) => [page.key, Joi.string().max(60000).allow("")]))),
  apiLoginSocial: Joi.object({
    googleClientId: text(),
    googleClientSecret: text(),
    googleCallbackUrl: url(),
    facebookAppId: text(),
    facebookAppSecret: text(),
    facebookCallbackUrl: url(),
  }),
  apiAppPassword: Joi.object({
    gmailUser: text(200),
    gmailPassword: text(200),
  }),
};

export const settingPatch = (key: keyof typeof schemas) => (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = schemas[key].validate(req.body, { stripUnknown: true });

  if (error) {
    res.status(400).json({ code: "error", message: error.details[0].message });
    return;
  }

  req.body = value;
  next();
};
