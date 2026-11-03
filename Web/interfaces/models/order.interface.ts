import { PaymentMethodId } from "../../configs/payment-methods.config";
import { Document, Types } from "mongoose";
import { IReview } from "./review.interface";

export interface IOrderItem {
  id?: string;
  _id?: string | Types.ObjectId;
  productId: string;
  quantity: number;
  price: number;
  variant: string[];
  rawVariant?: Array<{ attrId?: string; value?: string; label?: string }>;
  image?: string;
  name?: string;
  review?: IReview | null;
}

export interface IOrderShipping {
  provider?: string;
  externalId?: string;
  goshipOrderId?: string;
  carrierName?: string;
  carrierCode?: string;
  fee?: number;
  cod?: number;
}

export type OrderStatus = "pending" | "confirmed" | "shipping" | "completed" | "cancelled" | "returned";
export type OrderPaymentStatus = "unpaid" | "paid" | "refunded";

export interface IOrder extends Document {
  userId?: string;
  code?: string;
  fullName?: string;
  phone?: string;
  address?: string;
  longitude?: number;
  latitude?: number;
  note?: string;
  items: IOrderItem[];
  subTotal?: number;
  coupon?: string;
  discount?: number;
  total?: number;
  paymentMethod: PaymentMethodId;
  paymentStatus: OrderPaymentStatus;
  orderStatus: OrderStatus;
  shipping?: IOrderShipping;
  usedPoint: number;
  pointDiscount: number;
  pointEarned?: number;
  isAnomalous?: boolean;
  anomalyScore?: number | null;
  anomalyReason?: string;
  anomalyDismissedAt?: Date;
  anomalyScoredAt?: Date;
  ip?: string;
  deleted: boolean;
  deletedBy?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
