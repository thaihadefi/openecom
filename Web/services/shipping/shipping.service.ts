import { getApiShipping, getGeneral } from "../../configs/setting.config";
import { SHIPPING_CONFIG } from "../../configs/shipping.config";
import { httpError } from "../../helpers/http-response.helper";
import { goshipProvider } from "./goship.provider";
import { IOrderShipping } from "../../interfaces/models/order.interface";
import { ShipmentInput, ShipmentResult, ShippingContext, ShippingProvider, ShippingQuoteInput, ShippingRate } from "./shipping-provider";

// Shipping providers the store ships with. To add one for a client: implement ShippingProvider
// in its own file (see goship.provider.ts) and list it here.
export const SHIPPING_PROVIDERS: ShippingProvider[] = [goshipProvider];

export const getShippingContext = async (): Promise<ShippingContext> => {
  const [settings, general] = await Promise.all([getApiShipping(), getGeneral()]);
  return { settings, general };
};

// Providers offered at checkout: those whose settings are filled in.
export const enabledShippingProviders = (ctx: ShippingContext): ShippingProvider[] =>
  SHIPPING_PROVIDERS.filter((p) => p.isConfigured(ctx.settings));

// Rates from every enabled provider, cheapest first. One provider failing does not hide the others;
// the error surfaces only when no provider could quote at all.
export const quoteShippingRates = async (input: ShippingQuoteInput, ctx: ShippingContext): Promise<ShippingRate[]> => {
  const providers = enabledShippingProviders(ctx).filter((p) => !p.needsDestination || input.destination);
  const results = await Promise.allSettled(providers.map((p) => p.getRates(input, ctx)));

  const rates: ShippingRate[] = [];
  let firstError: unknown;
  results.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      rates.push(...result.value.map((rate) => ({ ...rate, id: `${provider.id}:${rate.id}`, provider: provider.id })));
    } else {
      firstError ??= result.reason;
      console.error(`[Shipping] ${provider.id} could not quote:`, result.reason instanceof Error ? result.reason.message : result.reason);
    }
  });

  if (rates.length === 0 && firstError) throw firstError;
  return rates.sort((a, b) => a.fee - b.fee);
};

// Books the shipment with the provider named in the chosen rate id ("<provider>:<rate>").
export const createShipment = async (rateId: string, input: Omit<ShipmentInput, "rateId">, ctx: ShippingContext): Promise<ShipmentResult> => {
  const separator = rateId.indexOf(":");
  const providerId = separator > 0 ? rateId.slice(0, separator) : "";
  const provider = enabledShippingProviders(ctx).find((p) => p.id === providerId);
  if (!provider) throw httpError(400, "Please select a shipping method again.");
  return provider.createShipment({ ...input, rateId: rateId.slice(separator + 1) }, ctx);
};

// Cancels the shipment an order booked, when its provider can. Best effort: a failure is logged for
// staff to cancel with the carrier, and never blocks the order flow that called it.
export const cancelOrderShipment = async (shipping: IOrderShipping | undefined, ctx?: ShippingContext): Promise<boolean> => {
  // Orders placed before providers were pluggable keep the GoShip code in goshipOrderId.
  const externalId = shipping?.externalId || shipping?.goshipOrderId;
  if (!externalId) return false;
  const providerId = shipping?.provider || (shipping?.goshipOrderId ? "goship" : "");
  const provider = SHIPPING_PROVIDERS.find((p) => p.id === providerId);
  if (!provider?.cancelShipment) return false;
  try {
    await provider.cancelShipment(externalId, ctx ?? await getShippingContext());
    return true;
  } catch (error: unknown) {
    console.error(`[Shipping] Could not cancel ${providerId} shipment ${externalId}; cancel it with the carrier:`,
      error instanceof Error ? error.message : error);
    return false;
  }
};

// Grams per unit: the product's own weight, else the store default.
export const unitWeight = (productWeight: number | null | undefined, ctx: ShippingContext): number => {
  if (typeof productWeight === "number" && productWeight > 0) return productWeight;
  const fallback = Number(ctx.settings.defaultItemWeight);
  return fallback > 0 ? fallback : SHIPPING_CONFIG.DEFAULT_ITEM_WEIGHT_GRAMS;
};
