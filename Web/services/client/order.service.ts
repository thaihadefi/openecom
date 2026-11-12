import mongoose from 'mongoose';
import { generateRandomNumber, generateRandomString } from '../../helpers/generate.helper';
import Order from '../../models/order.model';
import Product from '../../models/product.model';
import { getActiveAttributes } from '../admin/attribute-product.service';
import Coupon from '../../models/coupon.model';
import { checkCouponValidity, couponRejectStatus } from './coupon.service';
import AccountUser from '../../models/account-user.model';
import { getApiPayment } from '../../configs/setting.config';
import { cancelOrderShipment, createShipment, getShippingContext, unitWeight } from '../shipping/shipping.service';
import { caughtErrorStatus, isExposed } from '../../helpers/http-response.helper';
import { enabledPaymentMethods } from '../../configs/payment-methods.config';
import { getStorefront, toMoney } from '../../configs/storefront.config';
import { formatPrice } from '../../helpers/format.helper';
import { sendMail, emailTemplates } from '../../helpers/mail.helper';
import { ICoupon } from '../../interfaces/models/coupon.interface';
import { IAttributeProduct } from '../../interfaces/models/attribute-product.interface';
import { invalidateUserDashboardCache } from './dashboard.service';
import { invalidateUserAuthCache } from './auth.service';
import { invalidateAdminDashboardCaches } from '../admin/dashboard.service';
import { invalidateProductCaches } from '../../helpers/metadata-cache.helper';
import { scoreOrderForAnomaly } from '../admin/anomaly-detection.service';
import { FEATURES } from '../../configs/features.config';

export interface OrderItemInput {
  productId: string;
  quantity: number;
  variant?: Array<{ attrId: string; label: string; value: string }>;
}

export interface OrderItemFinal {
  productId: string;
  quantity: number;
  price: number;
  variant?: string[];
  rawVariant?: Array<{ attrId?: string; label?: string; value?: string }>;
  image?: string;
  name: string;
}

export interface CreateOrderPayload {
  fullName?: string;
  phone?: string;
  address?: string;
  longitude?: number;
  latitude?: number;
  note?: string;
  coupon?: string;
  paymentMethod?: string;
  shippingMethod?: string;
  items?: OrderItemInput[];
  usePoint?: boolean | number | string;
  usedPoint?: unknown;
}

export const createOrder = async (
  payload: CreateOrderPayload,
  accountUser?: { id?: string; email?: string; totalPoint?: number; usedPoint?: number },
  clientIp?: string
) => {
  const dataFinal: {
    userId?: string;
    code?: string;
    fullName?: string;
    phone?: string;
    address?: string;
    longitude?: number;
    latitude?: number;
    note?: string;
    coupon?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    orderStatus?: string;
    items: OrderItemFinal[];
    subTotal: number;
    discount: number;
    _couponId?: string;
    usedPoint: number;
    pointDiscount: number;
    shipping: {
      provider?: string;
      externalId?: string;
      carrierName?: string;
      carrierCode?: string;
      fee: number;
      cod?: number;
    };
    total: number;
    ip?: string;
  } = {
    items: [],
    subTotal: 0,
    discount: 0,
    usedPoint: 0,
    pointDiscount: 0,
    shipping: { fee: 0 },
    total: 0
  };

  const paymentMethod = enabledPaymentMethods(await getApiPayment()).find((m) => m.id === payload.paymentMethod);
  if (!paymentMethod) {
    return { success: false, status: 400, message: "This payment method is not available. Please choose another one." };
  }

  dataFinal.userId = accountUser?.id || "";
  dataFinal.ip = clientIp;

  let code = "";
  let existCode = true;
  while (existCode) {
    code = generateRandomString(2).toUpperCase() + generateRandomNumber(6);
    const existOrderCode = await Order.findOne({ code }).select("_id");
    if (!existOrderCode) {
      existCode = false;
    }
  }
  dataFinal.code = code;

  dataFinal.fullName = payload.fullName;
  dataFinal.phone = payload.phone;
  dataFinal.address = payload.address;
  dataFinal.longitude = payload.longitude;
  dataFinal.latitude = payload.latitude;
  dataFinal.note = payload.note;
  dataFinal.coupon = payload.coupon;
  dataFinal.paymentMethod = payload.paymentMethod;
  dataFinal.paymentStatus = "unpaid";
  dataFinal.orderStatus = "pending";

  const itemsInput: OrderItemInput[] = payload.items || [];
  const productIds = itemsInput.map((i) => i.productId);

  const [productList, attributeList] = await Promise.all([
    Product.find({ _id: { $in: productIds }, deleted: false, status: "active" }).select("_id name priceNew stock weight images variants"),
    getActiveAttributes()
  ]);

  const productMap = new Map(productList.map((p) => [String(p._id), p]));
  const attributeMap = new Map((attributeList as IAttributeProduct[]).map((a) => [String(a._id), a]));

  const requestedVariantStock = new Map<string, number>();
  const requestedProductStock = new Map<string, number>();

  dataFinal.items = [];
  for (const item of itemsInput) {
    const productDetail = productMap.get(String(item.productId));

    if (productDetail) {
      let price = 0;
      const variant: string[] = [];
      let variantImage: string | undefined;

      if (item.variant && item.variant.length > 0) {
        const variantMatched = (productDetail.variants || []).find((variantItem: { attributeValue?: Array<{ attrId?: string; value?: string }> }) => {
          return (
            (variantItem.attributeValue || []).length === item.variant?.length &&
            (variantItem.attributeValue || []).every((attr) => {
              const selected = item.variant?.find((v) => String(v.attrId) === String(attr.attrId));
              return selected && String(selected.value) === String(attr.value);
            })
          );
        });
        if (!variantMatched) {
          return {
            success: false,
            status: 400, message: `Invalid variant selected for product: ${productDetail.name}!`
          };
        }
        if ((variantMatched as { status?: boolean }).status === false) {
          return {
            success: false,
            status: 409, message: `Selected variant for ${productDetail.name} is currently unavailable!`
          };
        }
        const variantStock = typeof (variantMatched as { stock?: number }).stock === "number"
          ? (variantMatched as { stock: number }).stock
          : (typeof productDetail.stock === "number" ? productDetail.stock : 0);

        const variantKey = `${item.productId}_${item.variant.map((v) => `${v.attrId}:${v.value}`).sort().join("_")}`;
        const currentVariantQty = (requestedVariantStock.get(variantKey) || 0) + item.quantity;
        if (variantStock < currentVariantQty) {
          return {
            success: false,
            status: 409, message: `Selected variant for ${productDetail.name} does not have enough stock!`
          };
        }
        requestedVariantStock.set(variantKey, currentVariantQty);

        price = (variantMatched as { priceNew?: number; price?: number }).priceNew ?? (variantMatched as { priceNew?: number; price?: number }).price ?? (productDetail.priceNew || 0);
        variantImage = (variantMatched as { image?: string }).image;
        for (const v of item.variant) {
          const attribute = attributeMap.get(String(v.attrId));
          if (attribute) variant.push(`${attribute.name}: ${v.label || v.value}`);
        }
      } else {
        if (productDetail.variants && productDetail.variants.length > 0) {
          return {
            success: false,
            status: 400, message: `Please select product options for: ${productDetail.name}!`
          };
        }
        price = productDetail.priceNew || 0;
      }

      if (typeof productDetail.stock === "number") {
        const currentProductQty = (requestedProductStock.get(String(item.productId)) || 0) + item.quantity;
        if (productDetail.stock < currentProductQty) {
          return {
            success: false,
            status: 409, message: `Product ${productDetail.name} does not have enough stock!`
          };
        }
        requestedProductStock.set(String(item.productId), currentProductQty);
      }

      dataFinal.items.push({
        productId: item.productId,
        quantity: item.quantity,
        price: price,
        variant: variant.length > 0 ? variant : undefined,
        rawVariant: item.variant && item.variant.length > 0 ? item.variant : undefined,
        image: variantImage || productDetail.images?.[0] || "",
        name: productDetail.name || ""
      });
    }
  }

  
  if (dataFinal.items.length === 0) {
    return { success: false, status: 409, message: "None of the products in your cart are available anymore." };
  }
  if (dataFinal.items.length < itemsInput.length) {
    return { success: false, status: 409, message: "Some items are no longer available. Please review your cart and try again." };
  }

  dataFinal.subTotal = dataFinal.items.reduce((total: number, item) => total + (item.price * item.quantity), 0);

  dataFinal.discount = 0;
  let couponDetail: ICoupon | null = null;
  if (payload.coupon && !FEATURES.COUPONS) {
    return { success: false, status: 400, message: "Coupons are not available in this store." };
  }
  if (payload.coupon) {
    const couponCheck = await checkCouponValidity(payload.coupon, accountUser?.id);
    if (!couponCheck.valid || !couponCheck.couponDetail) {
      return { success: false, status: couponRejectStatus(couponCheck.reason), message: couponCheck.message || "Invalid coupon code!" };
    }
    couponDetail = couponCheck.couponDetail;
    dataFinal.coupon = couponDetail.code;

    if (couponDetail.minOrderValue && dataFinal.subTotal < couponDetail.minOrderValue) {
      return {
        success: false,
        status: 400, message: `Order must be at least ${formatPrice(couponDetail.minOrderValue)} to use this coupon!`
      };
    }

    if (couponDetail.typeDiscount === "percentage") {
      const discountValue = toMoney((dataFinal.subTotal * (couponDetail.value || 0)) / 100);
      dataFinal.discount = couponDetail.maxDiscountValue && couponDetail.maxDiscountValue > 0
        ? Math.min(discountValue, couponDetail.maxDiscountValue)
        : discountValue;
    } else {
      dataFinal.discount = Math.min(couponDetail.value || 0, dataFinal.subTotal);
    }

    dataFinal._couponId = String(couponDetail._id);
  }

  dataFinal.usedPoint = 0;
  dataFinal.pointDiscount = 0;
  const wantUsePoint = payload.usedPoint ?? payload.usePoint;
  if (FEATURES.LOYALTY_POINTS && accountUser && wantUsePoint) {
    const availablePoint = Math.max(0, (accountUser.totalPoint || 0) - (accountUser.usedPoint || 0));
    const maxPayable = Math.max(0, dataFinal.subTotal - dataFinal.discount);
    const maxPointsNeeded = Math.ceil(maxPayable / getStorefront().pointValue);

    let requestedPoint = 0;
    if (wantUsePoint === true || wantUsePoint === "true") {
      requestedPoint = Math.min(availablePoint, maxPointsNeeded);
    } else {
      const parsed = parseInt(`${wantUsePoint}`, 10) || 0;
      requestedPoint = Math.max(0, Math.min(parsed, availablePoint, maxPointsNeeded));
    }

    if (requestedPoint > 0) {
      dataFinal.usedPoint = requestedPoint;
      dataFinal.pointDiscount = Math.min(maxPayable, dataFinal.usedPoint * getStorefront().pointValue);
    }
  }

  const shippingCtx = await getShippingContext();
  const totalWeight = dataFinal.items.reduce(
    (total: number, item) => total + item.quantity * unitWeight(productMap.get(String(item.productId))?.weight, shippingCtx),
    0
  );
  const payable = Math.max(0, dataFinal.subTotal - dataFinal.discount - dataFinal.pointDiscount);

  try {
    dataFinal.shipping = await createShipment(String(payload.shippingMethod || ""), {
      destination: { lat: dataFinal.latitude || 0, lng: dataFinal.longitude || 0 },
      parcel: {
        weightGrams: totalWeight,
        orderValue: dataFinal.subTotal,
        declaredValue: payable,
        codAmount: paymentMethod.collectOnDelivery ? payable : 0
      },
      receiver: { name: dataFinal.fullName || "", phone: dataFinal.phone || "", address: dataFinal.address || "" },
      receiverPays: paymentMethod.collectOnDelivery
    }, shippingCtx);
  } catch (error: unknown) {
    if (isExposed(error)) return { success: false, status: caughtErrorStatus(error), message: error.message };
    console.error("[Checkout] Shipping provider failed:", error instanceof Error ? error.message : error);
    return { success: false, status: 502, message: "Unable to calculate the shipping fee. Please recheck your delivery address or try again later." };
  }

  dataFinal.total = Math.max(0, dataFinal.subTotal + dataFinal.shipping.fee - dataFinal.discount - dataFinal.pointDiscount);
  if (dataFinal.total === 0) {
    dataFinal.paymentStatus = "paid";
  }

  let savedOrderId: string | undefined;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (accountUser?.id && couponDetail) {
        await AccountUser.updateOne({ _id: accountUser.id }, { $inc: { orderLock: 1 } }, { session });
        const recheck = await checkCouponValidity(couponDetail.code as string, accountUser.id, session);
        if (!recheck.valid) {
          throw Object.assign(new Error(recheck.message || "Invalid coupon code!"), { code: "coupon_invalid", status: couponRejectStatus(recheck.reason) });
        }
      }

      const productIds = [...new Set(dataFinal.items.map((i) => i.productId).filter(Boolean))];
      const productList = await Product.find({
        _id: { $in: productIds },
        deleted: false,
        status: "active"
      }).session(session);
      const productMap = new Map(productList.map((p) => [String(p._id), p]));

      for (const item of dataFinal.items) {
        const product = productMap.get(String(item.productId));

        if (!product) {
          throw Object.assign(new Error("One or more items are out of stock!"), { code: "out_of_stock", status: 409 });
        }

        if (typeof product.stock === "number") {
          if (product.stock < item.quantity) {
            throw Object.assign(new Error(`Product ${product.name} is out of stock!`), { code: "out_of_stock", status: 409 });
          }
          product.stock = Math.max(0, product.stock - item.quantity);
        }

        const rawVariant = item.rawVariant;
        if (product.variants && product.variants.length > 0) {
          if (!rawVariant || rawVariant.length === 0) {
            throw Object.assign(new Error(`Please select product options for ${product.name}!`), { code: "out_of_stock", status: 400 });
          }
          const vMatched = product.variants.find((v) =>
            v.attributeValue &&
            v.attributeValue.length === rawVariant.length &&
            v.attributeValue.every((attr) => {
              const sel = rawVariant.find((s: { attrId?: string; value?: string }) => String(s.attrId) === String(attr.attrId));
              return sel && String(sel.value) === String(attr.value);
            })
          );

          if (!vMatched) {
            throw Object.assign(new Error(`Selected variant for ${product.name} is no longer available!`), { code: "out_of_stock", status: 409 });
          }

          if (vMatched.status === false) {
            throw Object.assign(new Error(`Selected variant for ${product.name} is currently unavailable!`), { code: "out_of_stock", status: 409 });
          }

          const variantStock = typeof vMatched.stock === "number"
            ? vMatched.stock
            : (typeof product.stock === "number" ? product.stock : 0);

          if (variantStock < item.quantity) {
            throw Object.assign(new Error(`Selected variant for ${product.name} is out of stock!`), { code: "out_of_stock", status: 409 });
          }

          vMatched.stock = Math.max(0, variantStock - item.quantity);
          product.markModified("variants");
        }
      }

      await Promise.all(productList.map((p) => p.save({ session })));

      if (dataFinal._couponId && couponDetail) {
        const queryCond: Record<string, unknown> = { _id: dataFinal._couponId, deleted: false, status: "active" };
        if (couponDetail.usageLimit && couponDetail.usageLimit > 0) {
          queryCond.usedCount = { $lt: couponDetail.usageLimit };
        }
        const couponUpdate = await Coupon.updateOne(queryCond, { $inc: { usedCount: 1 } }, { session });
        if (couponUpdate.modifiedCount === 0) {
          throw Object.assign(new Error("Coupon has reached its usage limit!"), { code: "coupon_limit", status: 409 });
        }
      }

      const newRecord = new Order(dataFinal);
      await newRecord.save({ session });
      savedOrderId = String(newRecord._id);

      if (accountUser?.id && dataFinal.usedPoint > 0) {
        const pointUpdate = await AccountUser.updateOne(
          {
            _id: accountUser.id,
            $expr: {
              $gte: [
                { $subtract: [{ $ifNull: ["$totalPoint", 0] }, { $ifNull: ["$usedPoint", 0] }] },
                dataFinal.usedPoint
              ]
            }
          },
          { $inc: { usedPoint: dataFinal.usedPoint } },
          { session }
        );
        if (pointUpdate.modifiedCount === 0) {
          throw Object.assign(new Error("Not enough loyalty points!"), { code: "points_insufficient", status: 409 });
        }
      }
    });
  } catch (error: unknown) {
    // The shipment was booked before the transaction. Release it unless the order was saved after all:
    // withTransaction can throw when a commit's outcome is unknown even though it succeeded.
    const committed = savedOrderId ? await Order.exists({ _id: savedOrderId }).catch(() => null) : null;
    if (!committed) await cancelOrderShipment(dataFinal.shipping, shippingCtx);
    const customErr = error as { code?: string; status?: number; message?: string };
    if (customErr?.code === "out_of_stock") {
      return { success: false, status: customErr.status ?? 409, message: customErr.message || "One or more items are out of stock!" };
    } else if (customErr?.code === "coupon_invalid") {
      return { success: false, status: customErr.status ?? 400, message: customErr.message || "Invalid coupon code!" };
    } else if (customErr?.code === "coupon_limit") {
      return { success: false, status: 409, message: "Coupon has reached its usage limit!" };
    } else if (customErr?.code === "points_insufficient") {
      return { success: false, status: 409, message: "Not enough loyalty points!" };
    } else if ((error as { code?: number })?.code === 11000) {
      return { success: false, status: 409, message: "Your order could not be saved this time. Please press Place Order again." };
    } else {
      console.error("Checkout transaction error:", error);
      return { success: false, status: 500, message: "An error occurred during checkout. Please try again." };
    }
  } finally {
    session.endSession();
  }

  if (accountUser?.id) {
    invalidateUserAuthCache(accountUser.id);
    invalidateUserDashboardCache(accountUser.id);
  }
  invalidateAdminDashboardCaches();
  invalidateProductCaches();

  if (savedOrderId && FEATURES.ML_FRAUD_DETECTION) {
    scoreOrderForAnomaly(savedOrderId).catch((error) => console.error("Anomaly scoring error:", error));
  }

  if (accountUser?.email) {
    emailTemplates.orderConfirmation({
      code: dataFinal.code || "",
      fullName: dataFinal.fullName || "",
      address: dataFinal.address || "",
      items: dataFinal.items,
      subTotal: dataFinal.subTotal,
      discount: dataFinal.discount,
      shipping: dataFinal.shipping,
      total: dataFinal.total,
      paymentMethod: dataFinal.paymentMethod || "",
      coupon: dataFinal.coupon || undefined,
      usedPoint: dataFinal.usedPoint,
      pointDiscount: dataFinal.pointDiscount,
    }).then(tpl => sendMail(accountUser.email!, tpl.subject, tpl.html))
      .catch(console.error);
  }

  const orderQuery = `orderCode=${encodeURIComponent(dataFinal.code || "")}&phone=${encodeURIComponent(dataFinal.phone || "")}`;
  const redirectUrl = paymentMethod.online && dataFinal.paymentStatus !== "paid"
    ? `/order/payment-${paymentMethod.id}?${orderQuery}`
    : `/order/success?${orderQuery}`;

  return {
    success: true,
    message: "Order placed successfully!",
    orderCode: dataFinal.code,
    phone: dataFinal.phone,
    total: dataFinal.total,
    paymentStatus: dataFinal.paymentStatus,
    redirectUrl
  };
};

export const getOrderByCodeAndPhone = async (code: string, phone: string) => {
  return Order.findOne({ code, phone, deleted: false });
};
