import { Request, Response } from 'express';
import * as orderService from '../../services/client/order.service';
import * as zalopayService from '../../services/payment/zalopay.service';
import * as vnpayService from '../../services/payment/vnpay.service';
import { startGatewayPayment } from '../../services/payment/payment-gateway.service';
import { resultStatus, sendCaughtError } from "../../helpers/http-response.helper";

export const createPost = async (req: Request, res: Response) => {
  try {
    const result = await orderService.createOrder(req.body, res.locals.accountUser, req.ip);

    if (!result.success) {
      res.status(resultStatus(result)).json({
        code: "error",
        message: result.message
      });
      return;
    }

    res.json({
      code: "success",
      message: result.message,
      orderCode: result.orderCode,
      phone: result.phone,
      total: result.total,
      paymentStatus: result.paymentStatus,
      redirectUrl: result.redirectUrl
    });
  } catch (error) {
    console.error("order createPost error:", error);
    sendCaughtError(res, error, "An error occurred during checkout. Please try again.", "An error occurred during checkout. Please try again.");
  }
};

export const success = async (req: Request, res: Response) => {
  const { orderCode, phone } = req.query;
  const paymentCheck = req.query.paymentCheck === "1";
  res.set("Cache-Control", "no-store");

  const orderDetail = await orderService.getOrderByCodeAndPhone(String(orderCode), String(phone));

  if (!orderDetail) {
    if (paymentCheck) {
      res.sendStatus(404);
      return;
    }
    res.redirect("/");
    return;
  }

  const orderEnded = ["cancelled", "returned"].includes(String(orderDetail.orderStatus)) || orderDetail.paymentStatus === "refunded";
  if (paymentCheck) {
    res.json({ settled: orderEnded || orderDetail.paymentStatus === "paid" });
    return;
  }

  res.render("client/pages/order-success", {
    pageTitle: "Order Success",
    orderDetail: orderDetail,
    orderCode: orderDetail.code || String(orderCode),
    // A cancelled, returned or refunded order is over, so the page does not celebrate it.
    orderEnded
  });
};

// Sends the customer to the gateway of an online payment method (also used by "Retry Payment").
export const paymentStart = async (req: Request, res: Response) => {
  const { orderCode, phone } = req.query;
  const ipAddr = req.ip || req.socket.remoteAddress;

  const result = await startGatewayPayment(String(req.params.method), String(orderCode), String(phone), ipAddr);

  if (!result) {
    res.redirect("/");
    return;
  }

  if (result.alreadyPaid) {
    res.redirect(`/order/success?orderCode=${encodeURIComponent(String(orderCode))}&phone=${encodeURIComponent(String(phone))}`);
    return;
  }

  res.redirect(result.paymentUrl || "/");
};

export const paymentZalopayResult = async (req: Request, res: Response) => {
  try {
    const result = await zalopayService.handleZaloPayCallback(req.body.data, req.body.mac);
    res.json(result);
  } catch (ex: unknown) {
    const errorMessage = ex instanceof Error ? ex.message : "ZaloPay callback error";
    res.json({ return_code: 0, return_message: errorMessage });
  }
};

export const paymentVNPayIpn = async (req: Request, res: Response) => {
  try {
    res.json(await vnpayService.handleVNPayIpn(req.query as Record<string, unknown>));
  } catch (error) {
    console.error("paymentVNPayIpn error:", error);
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
};

export const paymentVNPayResult = async (req: Request, res: Response) => {
  try {
    const redirectUrl = await vnpayService.handleVNPayResult(req.query as Record<string, unknown>);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("paymentVNPayResult error:", error);
    res.redirect("/");
  }
};
