import { getApiShipping, getGeneral } from "../../configs/setting.config";
import { SHIPPING_CONFIG } from "../../configs/shipping.config";
import { httpError } from "../../helpers/http-response.helper";
import { goshipProvider } from "./goship.provider";
import { IOrderShipping } from "../../interfaces/models/order.interface";
import ShipmentCancelTask from "../../models/shipment-cancel-task.model";
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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Minutes to wait before retry number `attempts` + 1: 5, 10, 20, ... capped at 6 hours.
export const retryDelayMinutes = (attempts: number): number =>
  Math.min(SHIPPING_CONFIG.CANCEL_RETRY_BASE_MINUTES * 2 ** attempts, SHIPPING_CONFIG.CANCEL_RETRY_MAX_MINUTES);

// Queues a booking whose cancellation failed, so the shipment-cancel job retries it.
// One task per booking; queueing it again keeps the existing schedule.
export const queueShipmentCancel = async (providerId: string, externalId: string, error: unknown, now = new Date()): Promise<void> => {
  try {
    await ShipmentCancelTask.updateOne(
      { provider: providerId, externalId },
      {
        $setOnInsert: { status: "pending", attempts: 0, nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(0) * 60000) },
        $set: { lastError: errorText(error) }
      },
      { upsert: true }
    );
  } catch (queueError: unknown) {
    console.error(`[Shipping] Could not queue the retry for ${providerId} shipment ${externalId}; cancel it with the carrier:`,
      errorText(queueError));
  }
};

// Cancels the shipment an order booked, when its provider can. Never blocks the order flow that called it:
// a failure is logged and queued, and the shipment-cancel job keeps retrying it.
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
    console.error(`[Shipping] Could not cancel ${providerId} shipment ${externalId}; queued for retry:`, errorText(error));
    await queueShipmentCancel(providerId, externalId, error);
    return false;
  }
};

// Retries the queued cancellations that are due. A success removes the task; after the last attempt
// the task is kept as "failed" and logged, so staff cancel it with the carrier by hand.
export const retryShipmentCancels = async (now = new Date(), shippingCtx?: ShippingContext): Promise<{ cancelled: number; failed: number }> => {
  const due = await ShipmentCancelTask.find({ status: "pending", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(SHIPPING_CONFIG.CANCEL_RETRY_BATCH);
  if (due.length === 0) return { cancelled: 0, failed: 0 };

  const ctx = shippingCtx ?? await getShippingContext();
  let cancelled = 0;
  let failed = 0;
  for (const task of due) {
    const provider = SHIPPING_PROVIDERS.find((p) => p.id === task.provider);
    try {
      if (!provider?.cancelShipment) throw new Error(`Provider "${task.provider}" cannot cancel shipments`);
      await provider.cancelShipment(task.externalId, ctx);
      await ShipmentCancelTask.deleteOne({ _id: task._id });
      cancelled += 1;
    } catch (error: unknown) {
      const attempts = (task.attempts ?? 0) + 1;
      const giveUp = attempts >= SHIPPING_CONFIG.CANCEL_RETRY_MAX_ATTEMPTS;
      await ShipmentCancelTask.updateOne(
        { _id: task._id },
        {
          attempts,
          lastError: errorText(error),
          status: giveUp ? "failed" : "pending",
          nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attempts) * 60000)
        }
      );
      if (giveUp) {
        failed += 1;
        console.error(`[Shipping] Gave up cancelling ${task.provider} shipment ${task.externalId} after ${attempts} attempts; cancel it with the carrier:`,
          errorText(error));
      }
    }
  }
  return { cancelled, failed };
};

// Grams per unit: the product's own weight, else the store default.
export const unitWeight = (productWeight: number | null | undefined, ctx: ShippingContext): number => {
  if (typeof productWeight === "number" && productWeight > 0) return productWeight;
  const fallback = Number(ctx.settings.defaultItemWeight);
  return fallback > 0 ? fallback : SHIPPING_CONFIG.DEFAULT_ITEM_WEIGHT_GRAMS;
};
