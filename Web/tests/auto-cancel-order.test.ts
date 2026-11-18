import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { autoCancelUnpaidOrders } from "../jobs/order.job";
import * as scheduler from "../jobs/scheduler";
import Order from "../models/order.model";
import * as orderHelpers from "../helpers/order.helper";
import * as shipping from "../services/shipping/shipping.service";

test("an aborted auto-cancellation attempt does not trigger side effects after a no-op retry", async (t) => {
  let run: (() => Promise<void>) | undefined;
  t.mock.method(scheduler, "scheduleJob", (_name: string, _cron: string, handler: () => Promise<void>) => {
    run = handler;
  });
  const order = { _id: new mongoose.Types.ObjectId(), code: "ORDER-1" };
  t.mock.method(Order, "find", () => ({ select: async () => [order] }));
  const results = [{ modifiedCount: 1 }, { modifiedCount: 0 }];
  t.mock.method(Order, "updateOne", async () => results.shift());
  const endSession = t.mock.fn();
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (callback: () => Promise<unknown>) => {
      await callback();
      return callback();
    },
    endSession,
  }));
  const release = t.mock.method(orderHelpers, "releaseOrderResources", async () => {});
  const notify = t.mock.method(orderHelpers, "notifyOrderStatusChange", () => {});
  const cancelShipment = t.mock.method(shipping, "cancelOrderShipment", async () => true);

  autoCancelUnpaidOrders();
  assert.ok(run);
  await run();

  assert.equal(release.mock.callCount(), 1);
  assert.equal(endSession.mock.callCount(), 1);
  assert.equal(notify.mock.callCount(), 0);
  assert.equal(cancelShipment.mock.callCount(), 0);
});
