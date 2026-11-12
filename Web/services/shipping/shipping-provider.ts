import { ISettingApiShipping, ISettingGeneral } from "../../interfaces/models/setting.interface";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ShippingParcel {
  /** Total weight in grams */
  weightGrams: number;
  /** Merchandise subtotal before discounts (free-shipping thresholds) */
  orderValue: number;
  /** Value declared to the carrier for insurance (what the customer pays for the goods) */
  declaredValue: number;
  /** Amount the courier collects on delivery (0 for prepaid orders) */
  codAmount: number;
}

export interface ShippingRate {
  /** Unique across providers: "<provider id>:<provider's own rate id>" */
  id: string;
  provider: string;
  carrierName: string;
  service: string;
  expected: string;
  fee: number;
}

export interface ShippingContext {
  settings: ISettingApiShipping;
  general: ISettingGeneral;
}

export interface ShippingQuoteInput {
  /** The customer's map location; missing until they pick one */
  destination?: GeoPoint;
  parcel: ShippingParcel;
}

export interface ShipmentInput extends ShippingQuoteInput {
  /** The provider's own rate id (without the provider prefix) */
  rateId: string;
  receiver: { name: string; phone: string; address: string };
  /** The courier's cost is paid by the receiver on delivery */
  receiverPays: boolean;
}

export interface ShipmentResult {
  provider: string;
  externalId?: string;
  carrierName?: string;
  carrierCode?: string;
  fee: number;
  cod?: number;
}

// A way of delivering orders. Checkout offers the rates of every configured provider and the
// customer picks one.
// Throw httpError(status, message) for a problem the customer should see.
export interface ShippingProvider {
  id: string;
  label: string;
  /** Rates depend on the customer's map location, so they are quoted only once it is known */
  needsDestination: boolean;
  /** Whether the store has filled in what this provider needs */
  isConfigured(settings: ISettingApiShipping): boolean;
  /** Rates with the provider's own ids; the service prefixes them with the provider id */
  getRates(input: ShippingQuoteInput, ctx: ShippingContext): Promise<Array<Omit<ShippingRate, "provider">>>;
  createShipment(input: ShipmentInput, ctx: ShippingContext): Promise<ShipmentResult>;
  /** Cancels a booked shipment by the provider's own id. Optional: without it, staff cancel with the carrier. */
  cancelShipment?(externalId: string, ctx: ShippingContext): Promise<void>;
}
