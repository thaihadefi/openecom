import { ClientSession } from "mongoose";
import Product from "../models/product.model";
import Coupon from "../models/coupon.model";
import AccountUser from "../models/account-user.model";
import { sendMail, emailTemplates } from "./mail.helper";
import { IOrder } from "../interfaces/models/order.interface";

export const releaseOrderResources = async (
  order: Pick<IOrder, "items" | "usedPoint" | "pointEarned" | "coupon" | "userId">,
  session: ClientSession,
): Promise<void> => {
  if (order.items && order.items.length > 0) {
    const productIds = [...new Set(order.items.map((i) => i.productId).filter(Boolean))];
    const productList = await Product.find({ _id: { $in: productIds } }).session(session);
    const productMap = new Map(productList.map((p) => [String(p._id), p]));

    for (const item of order.items) {
      const product = productMap.get(String(item.productId));
      if (product) {
        if (typeof product.stock === "number") {
          product.stock += item.quantity || 0;
        }
        const rawVariant = (item as { rawVariant?: Array<{ attrId?: string; value?: string }> }).rawVariant;
        if (rawVariant && rawVariant.length > 0 && product.variants && product.variants.length > 0) {
          const vMatched = product.variants.find((v) =>
            v.attributeValue &&
            v.attributeValue.length === rawVariant.length &&
            v.attributeValue.every((attr) => {
              const sel = rawVariant.find((s) => String(s.attrId) === String(attr.attrId));
              return sel && String(sel.value) === String(attr.value);
            })
          );
          if (vMatched && typeof vMatched.stock === "number") {
            vMatched.stock += item.quantity || 0;
            product.markModified("variants");
          }
        } else if (item.variant && item.variant.length > 0 && product.variants && product.variants.length > 0) {
          const vMatched = product.variants.find((v) => {
            const vStrings = (v.attributeValue || []).map((av) => (av.label || av.value || "").toLowerCase());
            return (item.variant || []).every((iv) => {
              const val = iv.includes(":") ? iv.split(":")[1].trim().toLowerCase() : iv.trim().toLowerCase();
              return vStrings.includes(val);
            });
          });
          if (vMatched && typeof vMatched.stock === "number") {
            vMatched.stock += item.quantity || 0;
            product.markModified("variants");
          }
        }
      }
    }
    for (const product of productList) await product.save({ session });
  }

  const userInc: Record<string, number> = {};
  if (order.usedPoint && order.usedPoint > 0) {
    userInc.usedPoint = -order.usedPoint;
  }
  if (order.pointEarned && order.pointEarned > 0) {
    userInc.totalPoint = -order.pointEarned;
  }
  if (Object.keys(userInc).length > 0) {
    await AccountUser.updateOne(
      { _id: order.userId },
      { $inc: userInc },
      { session },
    );
  }

  if (order.coupon) {
    await Coupon.updateOne(
      { code: order.coupon, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      { session },
    );
  }
};

export const notifyOrderStatusChange = (
  order: Pick<IOrder, "userId" | "code">,
  newStatus: string,
): void => {
  if (!order.userId) return;

  AccountUser.findOne({ _id: order.userId })
    .select("email fullName")
    .then((user) => {
      if (!user?.email) return;
      return emailTemplates
        .orderStatusUpdate(
          { code: order.code ?? "", fullName: user.fullName ?? "" },
          newStatus,
        )
        .then((tpl) => sendMail(user.email!, tpl.subject, tpl.html));
    })
    .catch(console.error);
};
