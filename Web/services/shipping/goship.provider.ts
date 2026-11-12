import axios from "axios";
import { getInfoAddress, getShopLocation, SHOP_NOT_CONFIGURED_MESSAGE } from "../../helpers/location.helper";
import { httpError } from "../../helpers/http-response.helper";
import { ShippingContext, ShippingProvider } from "./shipping-provider";

interface GoShipRate {
  id: string;
  carrier_name: string;
  carrier_short_name?: string;
  service: string;
  expected: string;
  total_fee: number;
}

const apiBase = (ctx: ShippingContext) => String(ctx.settings.goshipApiUrl || "https://sandbox.goship.io/api/v2");

const authHeaders = (ctx: ShippingContext) => ({
  Authorization: `Bearer ${ctx.settings.tokenGoShip}`,
  "Content-Type": "application/json"
});

const shopLocationOrFail = (ctx: ShippingContext) => {
  const location = getShopLocation(ctx.general);
  if (!location) {
    console.error("[Shipping] Warehouse latitude/longitude are missing in Settings > General.");
    throw httpError(503, SHOP_NOT_CONFIGURED_MESSAGE);
  }
  return location;
};

// GoShip (Vietnam) compares carriers; addresses are resolved from map coordinates.
export const goshipProvider: ShippingProvider = {
  id: "goship",
  label: "GoShip (carrier comparison, Vietnam)",
  needsDestination: true,
  isConfigured: (settings) => Boolean(String(settings.tokenGoShip || "").trim()),

  async getRates({ destination, parcel }, ctx) {
    if (!destination) return [];
    const shop = shopLocationOrFail(ctx);
    const [from, to] = await Promise.all([
      getInfoAddress(shop.lat, shop.lng),
      getInfoAddress(destination.lat, destination.lng)
    ]);

    const res = await axios.post(`${apiBase(ctx)}/rates`, {
      shipment: {
        address_from: from,
        address_to: to,
        parcel: { cod: "0", amount: "0", weight: parcel.weightGrams, width: "10", height: "10", length: "10" }
      }
    }, { headers: authHeaders(ctx) });

    const rates: GoShipRate[] = Array.isArray(res.data?.data) ? res.data.data : [];
    // GoShip can quote one service from several price tables; shoppers can't tell identical rows apart, so keep one.
    const seen = new Set<string>();
    const distinct = rates.filter((r) => {
      const key = [r.carrier_name, r.service, r.expected, r.total_fee].map((part) => String(part ?? "").trim()).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return distinct.map((r) => ({
      id: String(r.id),
      carrierName: r.carrier_name,
      service: r.service,
      expected: r.expected,
      fee: r.total_fee
    }));
  },

  async createShipment({ destination, parcel, rateId, receiver, receiverPays }, ctx) {
    if (!destination) throw httpError(400, "Please select a location on the map!");
    const shop = shopLocationOrFail(ctx);
    // GoShip needs the store as sender; refuse the order rather than ship with stale sender details.
    const senderPhone = String(ctx.general.shopSenderPhone || "").trim();
    const senderAddress = String(ctx.general.shopSenderAddress || "").trim();
    if (!senderPhone || !senderAddress) {
      console.error("[Shipping] Store phone or address is missing in Settings > General.");
      throw httpError(503, SHOP_NOT_CONFIGURED_MESSAGE);
    }

    const [from, to] = await Promise.all([
      getInfoAddress(shop.lat, shop.lng),
      getInfoAddress(destination.lat, destination.lng)
    ]);

    let res;
    try {
      res = await axios.post(`${apiBase(ctx)}/shipments`, {
        shipment: {
          rate: rateId,
          payer: receiverPays ? 1 : 0,
          address_from: {
            name: String(ctx.general.shopSenderName || ctx.general.websiteName || "Store"),
            phone: senderPhone,
            street: senderAddress,
            ...from
          },
          address_to: { name: receiver.name, phone: receiver.phone, street: receiver.address, ...to },
          parcel: {
            cod: `${parcel.codAmount}`,
            amount: `${parcel.declaredValue}`,
            weight: `${parcel.weightGrams}`,
            width: "10",
            height: "10",
            length: "10",
            metadata: "Fragile items, please handle with care."
          }
        }
      }, { headers: authHeaders(ctx) });
    } catch (error: unknown) {
      console.error("[Shipping] GoShip request failed:", error instanceof Error ? error.message : error);
      throw httpError(502, "Unable to calculate the shipping fee. Please recheck your delivery address or try again later.");
    }

    if (typeof res.data?.fee !== "number") {
      console.error("[Shipping] GoShip returned an unexpected payload:", res.data);
      throw httpError(502, "The shipping service is temporarily unavailable. Please try again later.");
    }

    return {
      provider: "goship",
      externalId: res.data.id,
      carrierName: res.data.carrier,
      carrierCode: res.data.carrier_short_name,
      fee: res.data.fee,
      cod: res.data.cod
    };
  },

  // DELETE /shipments/{id}, where id is the GoShip shipment code returned when it was booked.
  async cancelShipment(externalId, ctx) {
    const res = await axios.delete(`${apiBase(ctx)}/shipments/${encodeURIComponent(externalId)}`, { headers: authHeaders(ctx) });
    if (res.data?.status && res.data.status !== "success") throw new Error(`GoShip refused: ${JSON.stringify(res.data)}`);
  }
};
