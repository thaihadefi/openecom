import Order from "../../models/order.model";
import AccountUser from "../../models/account-user.model";
import { emailTemplates, sendMail } from "../../helpers/mail.helper";
import { addPointAfterPayment } from "../../helpers/point.helper";
import { invalidateAdminDashboardCaches } from "../admin/dashboard.service";
import { invalidateUserAuthCache } from "../client/auth.service";
import { invalidateUserDashboardCache } from "../client/dashboard.service";

export type PaymentApplyResult = "paid" | "already-paid" | "not-found" | "amount-mismatch";

async function sendPaymentReceipt(userId: string, orderCode: string, amount: number, method: string) {
  const account = await AccountUser.findOne({ _id: userId, deleted: false }).select("email");
  if (!account?.email) return;
  const receipt = await emailTemplates.paymentReceived(orderCode, amount, method);
  await sendMail(account.email, receipt.subject, receipt.html);
}

export const applyGatewayPayment = async (phone: string, orderCode: string, paidAmount: number): Promise<PaymentApplyResult> => {
  const order = await Order.findOne({ phone, code: orderCode, deleted: false }).select("_id total paymentStatus");
  if (!order) return "not-found";
  if (order.paymentStatus === "paid") return "already-paid";
  if (!Number.isFinite(paidAmount) || paidAmount !== (order.total || 0)) return "amount-mismatch";

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: "unpaid" },
    { paymentStatus: "paid" }
  );
  if (!claimed) return "already-paid";

  if (claimed.orderStatus === "cancelled" || claimed.orderStatus === "returned") {
    console.warn(`[Payment] Order ${orderCode} was ${claimed.orderStatus} when its payment arrived. Refund required.`);
  } else {
    if (claimed.userId) {
      sendPaymentReceipt(claimed.userId, orderCode, paidAmount, claimed.paymentMethod || "")
        .catch(error => console.error(`[Payment] Could not send receipt for order ${orderCode}:`, error));
    }
    await addPointAfterPayment(orderCode);
  }

  invalidateAdminDashboardCaches();
  if (claimed.userId) {
    invalidateUserAuthCache(claimed.userId);
    invalidateUserDashboardCache(claimed.userId);
  }
  return "paid";
};
