import nodemailer from "nodemailer";
import { getApiAppPassword, getGeneral } from "../configs/setting.config";
import { formatPrice } from "./format.helper";
import { getStorefront } from "../configs/storefront.config";
import { paymentMethodLabel } from "../configs/payment-methods.config";

// Email colors follow the storefront theme (Settings > Storefront).
const brandPrimary = () => getStorefront().primaryColor;
const brandSecondary = () => getStorefront().secondaryColor;

// A light tint of the primary color for backgrounds; email clients do not support CSS color-mix().
const brandTint = (): string => {
  const hex = getStorefront().primaryColor.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#f3f4f6";
  const mix = (offset: number) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * 0.08 + 255 * 0.92)
    .toString(16).padStart(2, "0");
  return `#${mix(0)}${mix(2)}${mix(4)}`;
};

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getStoreName(): Promise<string> {
  const general = await getGeneral();
  return String(general.websiteName || "Store");
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  shipping: "Shipping",
  completed: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned"
};

function buildEmailHtml(storeName: string, title: string, bodyHtml: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="${htmlEscape(getStorefront().language)}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
        <tr><td style="background:${brandPrimary()};padding:20px 32px;border-radius:8px 8px 0 0;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">${storeName}</span>
        </td></tr>
        <tr><td style="background:${brandSecondary()};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="background:#ffffff;padding:28px 32px 8px;">
          <h2 style="margin:0;color:#111827;font-size:18px;font-weight:600;line-height:1.4;">${title}</h2>
        </td></tr>
        <tr><td style="background:#ffffff;padding:12px 32px 32px;color:#374151;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;">
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This is an automated message from ${storeName}. Please do not reply to this email.<br>
            &copy; ${year} ${storeName}. All rights reserved.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function otpBlock(otp: string): string {
  return `<div style="background:${brandTint()};border:2px dashed ${brandPrimary()};border-radius:8px;padding:24px;text-align:center;margin:20px 0;">
  <span style="font-size:38px;font-weight:700;letter-spacing:12px;color:${brandPrimary()};font-family:monospace;">${htmlEscape(otp)}</span>
</div>`;
}

function warningBlock(message: string): string {
  return `<div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;padding:12px 16px;margin:20px 0;">
  <p style="margin:0;color:#991b1b;font-size:14px;font-weight:600;">${message}</p>
</div>`;
}

export const emailTemplates = {

  forgotPasswordOtp: async (otp: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Password Recovery OTP - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Reset Your Password",
        `<p>We received a request to reset your account password. Use the code below to continue:</p>
        ${otpBlock(otp)}
        <p style="color:#6b7280;font-size:14px;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
        <p style="color:#6b7280;font-size:14px;">If you did not request a password reset, you can safely ignore this email.</p>`
      )
    };
  },

  emailChangeOtp: async (otp: string, newEmail: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Email Change Verification - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Verify Your New Email Address",
        `<p>A request was made to link <strong>${htmlEscape(newEmail)}</strong> to your account.</p>
        <p>Enter the code below to confirm ownership of this address:</p>
        ${otpBlock(otp)}
        <p style="color:#6b7280;font-size:14px;">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#6b7280;font-size:14px;">If you did not request this, you can safely ignore this email.</p>`
      )
    };
  },

  emailChangeSecurityAlert: async (newEmail: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Security Alert: Email Change Requested - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Email Change Requested on Your Account",
        `<p>A request was submitted to change the email address on your account.</p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f9fafb;border-radius:6px;padding:12px 16px;width:100%;">
          <tr><td style="color:#6b7280;font-size:13px;">Requested new email</td></tr>
          <tr><td style="color:#111827;font-weight:600;">${htmlEscape(newEmail)}</td></tr>
        </table>
        ${warningBlock("If this was NOT you, change your password immediately to secure your account.")}
        <p style="color:#6b7280;font-size:14px;">If this was you, no further action is needed on this address.</p>`
      )
    };
  },

  emailChanged: async (oldEmail: string, newEmail: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Your Email Address Has Been Changed - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Email Address Changed Successfully",
        `<p>The email address on your account has been updated.</p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f9fafb;border-radius:6px;padding:12px 16px;width:100%;">
          <tr><td style="color:#6b7280;font-size:13px;padding-bottom:4px;">Previous email</td></tr>
          <tr><td style="color:#111827;font-weight:600;padding-bottom:12px;">${htmlEscape(oldEmail)}</td></tr>
          <tr><td style="color:#6b7280;font-size:13px;padding-bottom:4px;">New email</td></tr>
          <tr><td style="color:#111827;font-weight:600;">${htmlEscape(newEmail)}</td></tr>
        </table>
        ${warningBlock("If you did not make this change, contact support immediately and reset your password.")}
        <p style="color:#6b7280;font-size:14px;">You will need to use your new email address to log in from now on.</p>`
      )
    };
  },

  paymentReceived: async (orderCode: string, amount: number, method: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Payment Received for Order #${orderCode} - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Payment Received",
        `<p>We received your payment for order <strong>#${htmlEscape(orderCode)}</strong>.</p>
        <p>Amount paid: <strong>${htmlEscape(formatPrice(amount))}</strong><br>
        Payment method: ${htmlEscape(paymentMethodLabel(method))}</p>`
      )
    };
  },

  orderConfirmation: async (order: {
    code: string;
    fullName: string;
    address: string;
    items: { name: string; quantity: number; price: number; variant?: string[] }[];
    subTotal: number;
    discount: number;
    shipping: { fee: number };
    total: number;
    paymentMethod: string;
    coupon?: string;
    usedPoint?: number;
    pointDiscount?: number;
  }) => {
    const storeName = await getStoreName();
    const itemRows = order.items.map(item => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-weight:600;">${htmlEscape(item.name)}</span>
          ${item.variant?.length ? `<br><span style="color:#6b7280;font-size:13px;">${item.variant.map(htmlEscape).join(", ")}</span>` : ""}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:center;">x${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${formatPrice(item.price * item.quantity)}</td>
      </tr>`).join("");

    const discountRow = order.discount > 0
      ? `<tr><td colspan="2" style="padding:4px 0;color:#6b7280;">Discount${order.coupon ? ` (${htmlEscape(order.coupon)})` : ""}</td><td style="padding:4px 0;text-align:right;color:#16a34a;">-${formatPrice(order.discount)}</td></tr>`
      : "";

    const pointDiscountRow = (order.pointDiscount && order.pointDiscount > 0)
      ? `<tr><td colspan="2" style="padding:4px 0;color:#6b7280;">Points Discount${order.usedPoint ? ` (${order.usedPoint} pts)` : ""}</td><td style="padding:4px 0;text-align:right;color:#16a34a;">-${formatPrice(order.pointDiscount)}</td></tr>`
      : "";

    return {
      subject: `Order Confirmed #${order.code} - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Your order has been placed!",
        `<p>Hi <strong>${htmlEscape(order.fullName)}</strong>, thank you for your order. We've received it and will process it shortly.</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f9fafb;border-radius:6px;padding:12px 16px;">
          <tr><td style="color:#6b7280;font-size:13px;">Order number</td><td style="text-align:right;font-weight:700;color:#111827;">#${htmlEscape(order.code)}</td></tr>
          <tr><td style="color:#6b7280;font-size:13px;padding-top:4px;">Delivery address</td><td style="text-align:right;color:#111827;font-size:14px;">${htmlEscape(order.address)}</td></tr>
          <tr><td style="color:#6b7280;font-size:13px;padding-top:4px;">Payment</td><td style="text-align:right;color:#111827;">${htmlEscape(paymentMethodLabel(order.paymentMethod))}</td></tr>
        </table>

        <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
          <tr><th style="text-align:left;color:#6b7280;font-size:13px;font-weight:600;padding-bottom:8px;">Item</th><th style="color:#6b7280;font-size:13px;font-weight:600;padding-bottom:8px;text-align:center;">Qty</th><th style="color:#6b7280;font-size:13px;font-weight:600;padding-bottom:8px;text-align:right;">Amount</th></tr>
          ${itemRows}
          <tr><td colspan="2" style="padding:8px 0;color:#6b7280;">Subtotal</td><td style="padding:8px 0;text-align:right;">${formatPrice(order.subTotal)}</td></tr>
          <tr><td colspan="2" style="padding:4px 0;color:#6b7280;">Shipping</td><td style="padding:4px 0;text-align:right;">${formatPrice(order.shipping.fee)}</td></tr>
          ${discountRow}
          ${pointDiscountRow}
          <tr><td colspan="2" style="padding:8px 0;font-weight:700;font-size:16px;border-top:2px solid #e5e7eb;">Total</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #e5e7eb;color:${brandPrimary()};">${formatPrice(order.total)}</td></tr>
        </table>

        <p style="color:#6b7280;font-size:14px;">We'll notify you when your order status changes.</p>`
      )
    };
  },

  orderStatusUpdate: async (order: { code: string; fullName: string }, newStatus: string) => {
    const storeName = await getStoreName();
    const label = ORDER_STATUS_LABEL[newStatus] || newStatus;
    const statusColor: Record<string, string> = {
      confirmed: "#16a34a",
      shipping: "#2563eb",
      completed: "#16a34a",
      cancelled: "#dc2626",
      returned: "#d97706"
    };
    const color = statusColor[newStatus] || "#374151";

    return {
      subject: `Order #${order.code} - ${label} - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Your order status has been updated",
        `<p>Hi <strong>${htmlEscape(order.fullName)}</strong>, your order <strong>#${htmlEscape(order.code)}</strong> has been updated.</p>
        <div style="background:#f9fafb;border-radius:8px;padding:20px 24px;margin:20px 0;text-align:center;">
          <span style="font-size:22px;font-weight:700;color:${color};">${htmlEscape(label)}</span>
        </div>
        <p style="color:#6b7280;font-size:14px;">If you have any questions about your order, please contact us.</p>`
      )
    };
  },

  passwordChanged: async (email: string) => {
    const storeName = await getStoreName();
    return {
      subject: `Security Alert: Your Password Was Changed - ${storeName}`,
      html: buildEmailHtml(
        storeName,
        "Your Password Has Been Changed",
        `<p>The password for your account (<strong>${htmlEscape(email)}</strong>) was successfully changed.</p>
        ${warningBlock("If you did not make this change, reset your password immediately and contact support.")}
        <p style="color:#6b7280;font-size:14px;">If this was you, no action is needed.</p>`
      )
    };
  },

};

export const buildOtpEmail = async (options: {
  heading: string;
  subtext: string;
  otp: string;
  expireMinutes?: number;
}): Promise<string> => {
  const { heading, subtext, otp, expireMinutes = 5 } = options;
  const storeName = await getStoreName();
  return buildEmailHtml(
    storeName,
    heading,
    `<p>${htmlEscape(subtext)}</p>
    ${otpBlock(otp)}
    <p style="color:#6b7280;font-size:14px;">This code expires in <strong>${expireMinutes} minutes</strong>. Do not share it with anyone.</p>`
  );
};

export const sendMail = async (email: string, title: string, content: string) => {
  const apiAppPassword = await getApiAppPassword();
  const gmailUser = String(apiAppPassword.gmailUser || "");
  const gmailPassword = String(apiAppPassword.gmailPassword || "");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    // Port 587 starts in plain text and upgrades with STARTTLS; `secure: true` is only for port 465.
    // requireTLS refuses to send if the upgrade does not happen.
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: gmailUser,
      pass: gmailPassword,
    }
  });

  const info = await transporter.sendMail({
    from: gmailUser,
    to: email,
    subject: title,
    html: content
  });
  console.log("Mail sent:", info.messageId);
};
