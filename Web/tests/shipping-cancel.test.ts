import { test, afterEach, mock } from "node:test";
import axios from "axios";
import assert from "node:assert/strict";
import { SHIPPING_PROVIDERS, cancelOrderShipment } from "../services/shipping/shipping.service";
import { goshipProvider } from "../services/shipping/goship.provider";
import { ShippingContext, ShippingProvider } from "../services/shipping/shipping-provider";

const ctx = { settings: {}, general: {} } as unknown as ShippingContext;

const fakeProvider = (cancelShipment?: ShippingProvider["cancelShipment"]): ShippingProvider => ({
  id: "fake",
  label: "Fake carrier",
  needsDestination: false,
  isConfigured: () => true,
  getRates: async () => [],
  createShipment: async () => ({ provider: "fake", fee: 0 }),
  ...(cancelShipment ? { cancelShipment } : {}),
});

const withProvider = (provider: ShippingProvider) => {
  SHIPPING_PROVIDERS.push(provider);
  return () => SHIPPING_PROVIDERS.splice(SHIPPING_PROVIDERS.indexOf(provider), 1);
};

afterEach(() => mock.restoreAll());

test("cancels the booked shipment with the provider that booked it", async () => {
  const cancel = mock.fn(async () => {});
  const remove = withProvider(fakeProvider(cancel));
  try {
    const cancelled = await cancelOrderShipment({ provider: "fake", externalId: "SHIP-1" }, ctx);
    assert.equal(cancelled, true);
    assert.equal(cancel.mock.callCount(), 1);
    assert.deepEqual(cancel.mock.calls[0].arguments, ["SHIP-1", ctx]);
  } finally {
    remove();
  }
});

test("orders from before pluggable providers cancel through GoShip by goshipOrderId", async () => {
  // cancelShipment is optional on the interface; GoShip implements it.
  const goship = goshipProvider as { cancelShipment: NonNullable<ShippingProvider["cancelShipment"]> };
  const cancel = mock.method(goship, "cancelShipment", async () => {});
  const cancelled = await cancelOrderShipment({ goshipOrderId: "GS8GK2DO9L" }, ctx);
  assert.equal(cancelled, true);
  assert.deepEqual(cancel.mock.calls[0].arguments, ["GS8GK2DO9L", ctx]);
});

test("does nothing when the order has no booked shipment", async () => {
  assert.equal(await cancelOrderShipment(undefined, ctx), false);
  assert.equal(await cancelOrderShipment({ provider: "goship", fee: 15000 }, ctx), false);
});

test("does nothing when the provider cannot cancel", async () => {
  const remove = withProvider(fakeProvider());
  try {
    assert.equal(await cancelOrderShipment({ provider: "fake", externalId: "SHIP-2" }, ctx), false);
  } finally {
    remove();
  }
});

test("a provider failure is logged, not thrown, so the order flow continues", async () => {
  const logged = mock.method(console, "error", () => {});
  const remove = withProvider(fakeProvider(async () => { throw new Error("carrier unreachable"); }));
  try {
    const cancelled = await cancelOrderShipment({ provider: "fake", externalId: "SHIP-3" }, ctx);
    assert.equal(cancelled, false);
    assert.equal(logged.mock.callCount(), 1);
    assert.match(String(logged.mock.calls[0].arguments[0]), /SHIP-3/);
  } finally {
    remove();
  }
});

test("GoShip cancels with DELETE /shipments/{code} and treats a non-success body as a failure", async () => {
  const goship = goshipProvider as { cancelShipment: NonNullable<ShippingProvider["cancelShipment"]> };
  const goshipCtx = { settings: { goshipApiUrl: "https://sandbox.goship.io/api/v2", tokenGoShip: "t" }, general: {} } as unknown as ShippingContext;

  const ok = mock.method(axios, "delete", async () => ({ data: { code: 200, status: "success" } }));
  await goship.cancelShipment("56GDG8F", goshipCtx);
  assert.equal(ok.mock.calls[0].arguments[0], "https://sandbox.goship.io/api/v2/shipments/56GDG8F");
  ok.mock.restore();

  mock.method(axios, "delete", async () => ({ data: { code: 404, status: "Error", message: "Not Found" } }));
  await assert.rejects(goship.cancelShipment("MISSING", goshipCtx), /GoShip refused/);
});
