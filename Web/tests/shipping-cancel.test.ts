import { test, afterEach, mock } from "node:test";
import axios from "axios";
import assert from "node:assert/strict";
import { SHIPPING_PROVIDERS, cancelOrderShipment, queueShipmentCancel, retryDelayMinutes, retryShipmentCancels } from "../services/shipping/shipping.service";
import ShipmentCancelTask from "../models/shipment-cancel-task.model";
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

test("a provider failure is logged and queued for retry, not thrown, so the order flow continues", async () => {
  const logged = mock.method(console, "error", () => {});
  const queued = mock.method(ShipmentCancelTask, "updateOne", async () => ({}));
  const remove = withProvider(fakeProvider(async () => { throw new Error("carrier unreachable"); }));
  try {
    const cancelled = await cancelOrderShipment({ provider: "fake", externalId: "SHIP-3" }, ctx);
    assert.equal(cancelled, false);
    assert.equal(logged.mock.callCount(), 1);
    assert.match(String(logged.mock.calls[0].arguments[0]), /SHIP-3/);
    assert.equal(queued.mock.callCount(), 1);
    const [filter, update, options] = queued.mock.calls[0].arguments as unknown as [object, { $set: { lastError: string } }, object];
    assert.deepEqual(filter, { provider: "fake", externalId: "SHIP-3" });
    assert.equal(update.$set.lastError, "carrier unreachable");
    assert.deepEqual(options, { upsert: true });
  } finally {
    remove();
  }
});

test("a failure to queue the retry is logged, never thrown", async () => {
  const logged = mock.method(console, "error", () => {});
  mock.method(ShipmentCancelTask, "updateOne", async () => { throw new Error("database down"); });
  await queueShipmentCancel("fake", "SHIP-4", new Error("carrier unreachable"));
  assert.match(String(logged.mock.calls[0].arguments[0]), /SHIP-4/);
});

test("retries wait longer each time, up to the cap", () => {
  assert.equal(retryDelayMinutes(0), 5);
  assert.equal(retryDelayMinutes(1), 10);
  assert.equal(retryDelayMinutes(3), 40);
  assert.equal(retryDelayMinutes(20), 360);
});

// Stands in for ShipmentCancelTask.find(...).sort(...).limit(...).
const dueTasks = (tasks: object[]) => mock.method(ShipmentCancelTask, "find", () => ({ sort: () => ({ limit: async () => tasks }) }) as never);

test("a queued cancellation that now succeeds is removed from the queue", async () => {
  const cancel = mock.fn(async () => {});
  const remove = withProvider(fakeProvider(cancel));
  dueTasks([{ _id: "t1", provider: "fake", externalId: "SHIP-5", attempts: 2 }]);
  const deleted = mock.method(ShipmentCancelTask, "deleteOne", async () => ({}));
  try {
    const result = await retryShipmentCancels(new Date(), ctx);
    assert.deepEqual(result, { cancelled: 1, failed: 0 });
    assert.deepEqual(cancel.mock.calls[0].arguments, ["SHIP-5", ctx]);
    assert.deepEqual(deleted.mock.calls[0].arguments, [{ _id: "t1" }]);
  } finally {
    remove();
  }
});

test("a queued cancellation that fails again is rescheduled with a longer wait", async () => {
  const now = new Date("2026-11-13T00:00:00Z");
  const remove = withProvider(fakeProvider(async () => { throw new Error("still down"); }));
  dueTasks([{ _id: "t2", provider: "fake", externalId: "SHIP-6", attempts: 1 }]);
  const updated = mock.method(ShipmentCancelTask, "updateOne", async () => ({}));
  try {
    const result = await retryShipmentCancels(now, ctx);
    assert.deepEqual(result, { cancelled: 0, failed: 0 });
    const [, update] = updated.mock.calls[0].arguments as unknown as [object, { attempts: number; status: string; nextAttemptAt: Date }];
    assert.equal(update.attempts, 2);
    assert.equal(update.status, "pending");
    assert.equal(update.nextAttemptAt.getTime(), now.getTime() + 20 * 60000);
  } finally {
    remove();
  }
});

test("after the last attempt the task is marked failed and logged for staff", async () => {
  const logged = mock.method(console, "error", () => {});
  const remove = withProvider(fakeProvider(async () => { throw new Error("still down"); }));
  dueTasks([{ _id: "t3", provider: "fake", externalId: "SHIP-7", attempts: 9 }]);
  const updated = mock.method(ShipmentCancelTask, "updateOne", async () => ({}));
  try {
    const result = await retryShipmentCancels(new Date(), ctx);
    assert.deepEqual(result, { cancelled: 0, failed: 1 });
    const [, update] = updated.mock.calls[0].arguments as unknown as [object, { status: string }];
    assert.equal(update.status, "failed");
    assert.match(String(logged.mock.calls[0].arguments[0]), /SHIP-7/);
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
