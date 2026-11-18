import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import * as settings from "../configs/setting.config";
import Order from "../models/order.model";
import Product from "../models/product.model";
import * as attributes from "../services/admin/attribute-product.service";
import * as anomalyDetection from "../services/admin/anomaly-detection.service";
import { createOrder } from "../services/client/order.service";
import * as shipping from "../services/shipping/shipping.service";

for (const outcome of ["committed", "aborted", "lookup-unavailable", "commit-unconfirmed"] as const) {
  test(`checkout handles the ${outcome} outcome after losing the commit response`, async (t) => {
    const productId = new mongoose.Types.ObjectId();
    const product = { _id: productId, name: "Product", priceNew: 100, stock: 5, save: async () => {} };
    const shipment = { provider: "goship", externalId: "SHIP-1", fee: 10 };
    const cancel = t.mock.method(shipping, "cancelOrderShipment", async () => true);
    t.mock.method(shipping, "getShippingContext", async () => ({ settings: {} }));
    t.mock.method(shipping, "createShipment", async () => shipment);
    t.mock.method(settings, "getApiPayment", async () => ({}));
    t.mock.method(attributes, "getActiveAttributes", async () => []);
    t.mock.method(anomalyDetection, "scoreOrderForAnomaly", async () => {});
    t.mock.method(Product, "find", () => ({
      select: async () => [product],
      session: async () => [product],
    }));
    t.mock.method(Order, "findOne", () => ({ select: async () => null }));
    t.mock.method(Order.prototype, "save", async () => {});
    t.mock.method(Order, "exists", (filter: { _id: string }) => ({
      read: async (preference: string) => {
        assert.equal(preference, "primary");
        assert.ok(mongoose.isValidObjectId(filter._id));
        if (outcome === "lookup-unavailable") throw new Error("Database unreachable");
        return outcome === "committed" ? { _id: filter._id } : null;
      },
    }));
    t.mock.method(mongoose.connection, "transaction", async (work: (session: object) => Promise<void>) => {
      await work({});
      const error = new mongoose.mongo.MongoError("Commit response lost");
      if (outcome !== "aborted") error.addErrorLabel("UnknownTransactionCommitResult");
      throw error;
    });
    t.mock.method(console, "error", () => {});

    const result = await createOrder({
      paymentMethod: "money",
      shippingMethod: "goship:rate-1",
      items: [{ productId: String(productId), quantity: 1 }],
    });

    assert.equal(cancel.mock.callCount(), outcome === "aborted" ? 1 : 0);
    if (outcome === "committed") {
      assert.equal(result.success, true);
      assert.match(result.redirectUrl ?? "", /^\/order\/success\?orderCode=/);
    } else {
      assert.equal(result.success, false);
      if (outcome !== "aborted") assert.match(result.message, /before placing another order/);
    }
  });
}
