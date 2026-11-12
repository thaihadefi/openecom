import { scheduleJob } from "./scheduler";
import mongoose from "mongoose";
import Order from "../models/order.model";
import { ONLINE_PAYMENT_METHOD_IDS } from "../configs/payment-methods.config";
import { releaseOrderResources, notifyOrderStatusChange } from "../helpers/order.helper";
import { cancelOrderShipment } from "../services/shipping/shipping.service";
import { invalidateAdminDashboardCaches } from "../services/admin/dashboard.service";
import { invalidateUserAuthCache } from "../services/client/auth.service";
import { invalidateUserDashboardCache } from "../services/client/dashboard.service";
import { invalidateProductCaches } from "../helpers/metadata-cache.helper";

export const autoCancelUnpaidOrders = () => {
  scheduleJob("cancel-unpaid-orders", "*/15 * * * *", async () => {
    const threshold = new Date(Date.now() - 30 * 60 * 1000);

    const staleOrders = await Order.find({
      paymentStatus: "unpaid",
      paymentMethod: { $in: ONLINE_PAYMENT_METHOD_IDS },
      orderStatus: "pending",
      deleted: false,
      createdAt: { $lt: threshold }
    }).select("_id code items userId usedPoint pointEarned coupon shipping");

    if (staleOrders.length === 0) return;

    const cancelPromises = staleOrders.map(async (order) => {
      try {
        const session = await mongoose.startSession();
        let cancelled = false;
        try {
          await session.withTransaction(async () => {
            const result = await Order.updateOne(
              { _id: order._id, orderStatus: "pending", paymentStatus: "unpaid" },
              { orderStatus: "cancelled", pointEarned: 0 },
              { session }
            );

            if (result.modifiedCount === 0) return;
            cancelled = true;

            await releaseOrderResources(order, session);
          });
        } finally {
          session.endSession();
        }

        if (cancelled) {
          notifyOrderStatusChange(order, "cancelled");
          void cancelOrderShipment(order.shipping);
          if (order.userId) {
            invalidateUserAuthCache(order.userId);
            invalidateUserDashboardCache(order.userId);
          }
          return true;
        }
        return false;
      } catch (error) {
        console.error(`Error cancelling stale order ${order._id}:`, error);
        return false;
      }
    });

    const results = await Promise.all(cancelPromises);
    if (results.some(Boolean)) {
      invalidateAdminDashboardCaches();
      invalidateProductCaches();
    }
  });
};
