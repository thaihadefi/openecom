import mongoose from 'mongoose';
import { IOrder, OrderStatus, OrderPaymentStatus } from '../../interfaces/models/order.interface';
import Order from '../../models/order.model';
import AccountUser from '../../models/account-user.model';
import { pointsEarnedFor } from '../../helpers/point.helper';
import { PAGINATION } from '../../configs/pagination.config';
import { getPagination } from '../../helpers/pagination.helper';
import { buildKeywordFilter } from '../../helpers/list-query.helper';
import { softDeleteMany, restoreMany, permanentlyDeleteMany, getTrash } from "../../helpers/admin-crud.helper";
import { releaseOrderResources, notifyOrderStatusChange } from "../../helpers/order.helper";
import { cancelOrderShipment } from "../shipping/shipping.service";
import { invalidateUserAuthCache } from "../client/auth.service";
import { invalidateUserDashboardCache } from "../client/dashboard.service";
import { invalidateAdminDashboardCaches } from "./dashboard.service";
import { invalidateProductCaches } from "../../helpers/metadata-cache.helper";

export const getOrderList = async (rawKeyword?: unknown, rawPage?: unknown) => {
  const find: Record<string, unknown> = {
    deleted: false
  };

  Object.assign(find, buildKeywordFilter(rawKeyword, ["code", "fullName", "phone"]));

  const limitItems = PAGINATION.ADMIN_LIMIT;
  const totalRecord = await Order.countDocuments(find);
  const pagination = getPagination(rawPage, limitItems, totalRecord);

  const recordList = await Order
    .find(find)
    .select("_id code fullName phone total orderStatus paymentStatus paymentMethod createdAt")
    .limit(limitItems)
    .skip(pagination.skip)
    .sort({ createdAt: "desc" });

  return {
    recordList,
    pagination
  };
};

export const getOrderDetailById = async (id: string) => {
  return Order.findOne({ _id: id, deleted: false });
};

const ORDER_STATUSES = ["pending", "confirmed", "shipping", "completed", "cancelled", "returned"];
const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"];
const TERMINAL_STATUSES = ["cancelled", "returned"];
const FINALIZED_STATUSES = ["completed", "cancelled", "returned"];

export const updateOrderAdmin = async (
  id: string,
  orderStatus: string,
  paymentStatus: string,
  note?: string
) => {
  if (!ORDER_STATUSES.includes(orderStatus) || !PAYMENT_STATUSES.includes(paymentStatus)) {
    return { success: false, status: 400, message: "Invalid order or payment status!" };
  }

  const state: { failure?: { status: number; message: string }; goingTerminal: boolean; statusChanged: boolean; order: IOrder | null } = {
    goingTerminal: false,
    statusChanged: false,
    order: null,
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      state.failure = undefined;
      const order = await Order.findOne({ _id: id, deleted: false }).session(session);

      if (!order) {
        state.failure = { status: 404, message: "Order does not exist!" };
        return;
      }
      if (FINALIZED_STATUSES.includes(order.orderStatus) && orderStatus !== order.orderStatus) {
        state.failure = { status: 409, message: "Cannot change the status of a finalized order!" };
        return;
      }
      if (order.paymentStatus === "paid" && paymentStatus === "unpaid") {
        state.failure = { status: 409, message: "Cannot change paid order status back to unpaid!" };
        return;
      }

      state.goingTerminal = TERMINAL_STATUSES.includes(orderStatus) && !TERMINAL_STATUSES.includes(order.orderStatus);
      state.statusChanged = order.orderStatus !== orderStatus;
      const wasUnpaid = order.paymentStatus !== "paid";

      order.orderStatus = orderStatus as OrderStatus;
      order.paymentStatus = paymentStatus as OrderPaymentStatus;
      if (note !== undefined) order.note = note;
      await order.save({ session });

      if (state.goingTerminal) {
        await releaseOrderResources(order, session);
        order.pointEarned = 0;
        await order.save({ session });
      }

      const earnsPoints = !TERMINAL_STATUSES.includes(orderStatus);
      if (earnsPoints && wasUnpaid && paymentStatus === "paid" && order.userId && (!order.pointEarned || order.pointEarned === 0)) {
        const pointEarned = pointsEarnedFor(order);
        if (pointEarned > 0) {
          order.pointEarned = pointEarned;
          await order.save({ session });
          await AccountUser.updateOne(
            { _id: order.userId, deleted: false, status: "active" },
            { $inc: { totalPoint: pointEarned } },
            { session }
          );
        }
      }

      state.order = order;
    });
  } finally {
    session.endSession();
  }

  const order = state.order;
  if (state.failure || !order) {
    return { success: false, status: state.failure?.status ?? 404, message: state.failure?.message || "Order does not exist!" };
  }

  if (order.userId) {
    invalidateUserAuthCache(order.userId);
    invalidateUserDashboardCache(order.userId);
  }

  invalidateAdminDashboardCaches();

  if (state.goingTerminal) {
    invalidateProductCaches();
  }

  if (state.statusChanged) {
    notifyOrderStatusChange(order, orderStatus);
    // A cancelled order no longer ships; a returned one was already delivered.
    if (orderStatus === "cancelled") void cancelOrderShipment(order.shipping);
  }

  return { success: true, message: "Order updated successfully!", order };
};

export const softDeleteOrder = async (id: string) => {
  const activeOrder = await Order.findOne({
    _id: id,
    orderStatus: { $nin: ["cancelled", "returned"] },
    deleted: false
  }).select("userId");
  if (activeOrder) {
    return {
      success: false,
      status: 409, message: "Cannot delete an active order! Please change its status to Cancelled or Returned first."
    };
  }

  const order = await Order.findById(id).select("userId");
  await Order.updateOne({ _id: id }, { deleted: true, deletedAt: new Date() });
  invalidateAdminDashboardCaches();
  if (order?.userId) {
    invalidateUserDashboardCache(order.userId);
  }
  return { success: true, message: "Order deleted successfully!" };
};

export const softDeleteManyOrders = async (ids: string[]) => {
  const activeOrdersCount = await Order.countDocuments({
    _id: { $in: ids },
    orderStatus: { $nin: ["cancelled", "returned"] },
    deleted: false
  });
  if (activeOrdersCount > 0) {
    return {
      success: false,
      status: 409, message: "Cannot delete active orders! Please change their status to Cancelled or Returned first."
    };
  }

  const orders = await Order.find({ _id: { $in: ids } }).select("userId");
  const result = await softDeleteMany(Order, ids, "order");
  invalidateAdminDashboardCaches();
  orders.forEach(o => { if (o.userId) invalidateUserDashboardCache(o.userId); });
  return result;
};

export const restoreOrder = async (id: string) => {
  await Order.updateOne({ _id: id }, { deleted: false });
  invalidateAdminDashboardCaches();
  const order = await Order.findById(id).select("userId");
  if (order?.userId) {
    invalidateUserDashboardCache(order.userId);
  }
  return { success: true, message: "Restored successfully!" };
};

export const restoreManyOrders = async (ids: string[]) => {
  const orders = await Order.find({ _id: { $in: ids } }).select("userId");
  const result = await restoreMany(Order, ids, "order");
  invalidateAdminDashboardCaches();
  orders.forEach(o => { if (o.userId) invalidateUserDashboardCache(o.userId); });
  return result;
};

export const permanentlyDeleteOrder = async (id: string) => {
  const activeOrder = await Order.findOne({
    _id: id,
    orderStatus: { $nin: ["cancelled", "returned"] }
  });
  if (activeOrder) {
    return {
      success: false,
      status: 409, message: "Cannot delete an active order! Please change its status to Cancelled or Returned first."
    };
  }

  const order = await Order.findById(id).select("userId");
  await Order.deleteOne({ _id: id });
  invalidateAdminDashboardCaches();
  if (order?.userId) {
    invalidateUserDashboardCache(order.userId);
  }
  return { success: true, message: "Deleted permanently!" };
};

export const permanentlyDeleteManyOrders = async (ids: string[]) => {
  const activeOrdersCount = await Order.countDocuments({
    _id: { $in: ids },
    orderStatus: { $nin: ["cancelled", "returned"] }
  });
  if (activeOrdersCount > 0) {
    return {
      success: false,
      status: 409, message: "Cannot delete active orders! Please change their status to Cancelled or Returned first."
    };
  }

  const orders = await Order.find({ _id: { $in: ids } }).select("userId");
  const result = await permanentlyDeleteMany(Order, ids, "order");
  invalidateAdminDashboardCaches();
  orders.forEach(o => { if (o.userId) invalidateUserDashboardCache(o.userId); });
  return result;
};

export const getOrderTrash = () => getTrash(Order, "_id code fullName phone total orderStatus paymentStatus deletedAt");

export const getOrdersBatchForExport = async (skip: number, limit: number) => {
  return Order.find({ deleted: false }).sort({ _id: 1 }).skip(skip).limit(limit).lean();
};
