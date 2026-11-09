import mongoose from 'mongoose';
import AccountUser from '../../models/account-user.model';
import VerifyOTP from '../../models/verify-otp.model';
import { consumeOtp } from '../../helpers/otp.helper';
import { toSearchText } from '../../helpers/slugify.helper';
import UserAddress from '../../models/user-address.model';
import { fmUpload, fmDeleteByLink } from '../../helpers/file-manager.client';
import Order from '../../models/order.model';
import Review from '../../models/review.model';
import Product from '../../models/product.model';
import { PAGINATION } from '../../configs/pagination.config';
import { getPagination } from '../../helpers/pagination.helper';
import { generateRandomNumber } from '../../helpers/generate.helper';
import { sendMail, emailTemplates } from '../../helpers/mail.helper';
import { IOrder, IOrderItem } from '../../interfaces/models/order.interface';
import { IUserAddressInput } from '../../interfaces/models/user-address.interface';
import { invalidateUserAuthCache } from './auth.service';
import { metadataCache, invalidateProductCaches } from '../../helpers/metadata-cache.helper';
import { upstreamStatus, httpError } from "../../helpers/http-response.helper";

export const invalidateUserDashboardCache = (userId: string) => {
  metadataCache.del(`user:dashboard:${userId}`);
};

export const getDashboardOverview = async (userId: string) => {
  const cacheKey = `user:dashboard:${userId}`;
  const cached = metadataCache.get<{
    totalOrders: number;
    totalCompletedOrders: number;
    totalReviews: number;
    orderList: unknown[];
  }>(cacheKey);
  if (cached) return cached;

  const [totalOrders, totalCompletedOrders, totalReviews, orderList] = await Promise.all([
    Order.countDocuments({ userId, deleted: false }),
    Order.countDocuments({ userId, orderStatus: "completed", deleted: false }),
    Review.countDocuments({ userId }),
    Order.find({ userId, deleted: false })
      .select("_id code total orderStatus paymentStatus paymentMethod createdAt")
      .sort({ createdAt: "desc" })
      .limit(5)
      .lean()
  ]);

  const result = {
    totalOrders,
    totalCompletedOrders,
    totalReviews,
    orderList: orderList.map((order) => ({ ...order, id: String(order._id) }))
  };

  metadataCache.set(cacheKey, result, 60);
  return result;
};

export const updateProfile = async (
  userId: string,
  currentEmail: string,
  fullName: string,
  phone?: string
) => {
  if (phone) {
    const existPhone = await AccountUser.findOne({
      _id: { $ne: userId },
      phone,
      deleted: false
    }).select("_id");
    if (existPhone) {
      return { success: false, status: 409, message: "Phone number already exists!" };
    }
  }

  await AccountUser.updateOne(
    { _id: userId },
    {
      fullName,
      phone,
      search: toSearchText(`${fullName} ${currentEmail} ${phone || ''}`)
    }
  );

  invalidateUserAuthCache(userId);

  return { success: true, message: "Update successful!" };
};

export const requestChangeEmail = async (
  userId: string,
  oldEmail: string,
  newEmail: string
) => {
  if (newEmail.trim().toLowerCase() === oldEmail.trim().toLowerCase()) {
    return { success: false, status: 400, message: "New email must be different from your current email!" };
  }

  const emailTaken = await AccountUser.findOne({
    email: newEmail,
    deleted: false,
    _id: { $ne: userId }
  }).select("_id");

  if (emailTaken) {
    return { success: false, status: 409, message: "This email is already in use by another account!" };
  }

  const otp = generateRandomNumber(6);

  await VerifyOTP.findOneAndUpdate(
    { userId, type: "otp-email-change" },
    { $set: { email: newEmail, otp, newEmail, attempts: 0, expireAt: new Date(Date.now() + 10 * 60 * 1000) } },
    { upsert: true }
  );

  const { subject: subjectNew, html: htmlNew } = await emailTemplates.emailChangeOtp(`${otp}`, newEmail);
  try {
    await sendMail(newEmail, subjectNew, htmlNew);
  } catch (mailErr) {
    console.error("[changeEmail] sendMail failed, rolling back OTP:", mailErr);
    await VerifyOTP.deleteOne({ userId, type: "otp-email-change" });
    return { success: false, status: 502, message: "Failed to send verification email. Please try again." };
  }

  void emailTemplates.emailChangeSecurityAlert(newEmail)
    .then(({ subject, html }) => sendMail(oldEmail, subject, html))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[changeEmail] security-alert email to ${oldEmail} failed (${msg})`);
    });

  return { success: true, message: "Verification code sent to your new email address!" };
};

export const verifyChangeEmail = async (userId: string, fullName: string, phone: string | undefined, otp: string) => {
  const record = await consumeOtp({ userId, type: "otp-email-change" }, otp);

  if (!record) {
    return { success: false, status: 400, message: "Invalid or expired OTP code!" };
  }

  const newEmail = record.newEmail as string;

  await AccountUser.updateOne(
    { _id: userId },
    {
      email: newEmail,
      emailVerified: true,
      search: toSearchText(`${fullName} ${newEmail} ${phone || ''}`)
    }
  );

  invalidateUserAuthCache(userId);

  return { success: true, message: "Email changed successfully! Please log in again with your new email." };
};

export const getUserAddresses = async (userId: string) => {
  return UserAddress.find({ userId })
    .select("_id fullName phone address longitude latitude isDefault")
    .sort({ createdAt: "desc" });
};

export const createUserAddress = async (userId: string, addressData: IUserAddressInput): Promise<{ success: boolean; status?: number; message: string; addressId?: string }> => {
  addressData.userId = userId;
  let addressId: string | undefined;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (addressData.isDefault) {
        await UserAddress.findOneAndUpdate(
          { userId, isDefault: true },
          { isDefault: false },
          { session }
        );
      }

      const newRecord = new UserAddress(addressData);
      await newRecord.save({ session });
      addressId = String(newRecord._id);
    });
  } finally {
    session.endSession();
  }

  invalidateUserAuthCache(userId);

  return { success: true, message: "Address added successfully!", addressId };
};


export const setDefaultUserAddress = async (userId: string, addressId: string) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const target = await UserAddress.findOne({ _id: addressId, userId }).select("_id").session(session);
      if (!target) throw httpError(404, "Address does not exist!");
      await UserAddress.findOneAndUpdate(
        { userId, isDefault: true },
        { isDefault: false },
        { session }
      );

      await UserAddress.findOneAndUpdate(
        { _id: addressId, userId },
        { isDefault: true },
        { session }
      );
    });
  } finally {
    session.endSession();
  }

  invalidateUserAuthCache(userId);

  return { success: true, message: "Address set as default!" };
};

export const deleteUserAddress = async (userId: string, addressId: string) => {
  await UserAddress.findOneAndDelete({ _id: addressId, userId });
  invalidateUserAuthCache(userId);
  return { success: true, message: "Address deleted successfully!" };
};

export const getUserAddressDetail = async (userId: string, addressId: string) => {
  return UserAddress.findOne({ _id: addressId, userId });
};

export const updateUserAddress = async (userId: string, addressId: string, addressData: IUserAddressInput): Promise<{ success: boolean; status?: number; message: string }> => {
  const existAddress = await UserAddress.findOne({ _id: addressId, userId }).select("_id");
  if (!existAddress) {
    return { success: false, status: 404, message: "Address does not exist!" };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (addressData.isDefault) {
        await UserAddress.findOneAndUpdate(
          { userId, isDefault: true },
          { isDefault: false },
          { session }
        );
      }

      await UserAddress.updateOne({ _id: addressId, userId }, addressData, { session });
    });
  } finally {
    session.endSession();
  }

  invalidateUserAuthCache(userId);


  return { success: true, message: "Address updated successfully!" };
};

export const updateAvatar = async (userId: string, file: Express.Multer.File, oldAvatar?: string) => {
  const upload = await fmUpload([file], `users/${userId}`);
  if (!upload.success || upload.fileUrls.length === 0) {
    return { success: false, status: upstreamStatus(upload.status), message: upload.message || "Upload error!" };
  }

  const linkAvatar = upload.fileUrls[0];
  await AccountUser.updateOne({ _id: userId }, { avatar: linkAvatar });
  invalidateUserAuthCache(userId);

  if (oldAvatar) {
    fmDeleteByLink(oldAvatar);
  }

  return { success: true, message: "Avatar updated successfully!", linkAvatar };
};

export const getOrderHistory = async (userId: string, rawPage: unknown) => {
  const find = { userId, deleted: false };
  const limitItems = PAGINATION.DASHBOARD_ORDER_LIMIT;
  const totalRecord = await Order.countDocuments(find);
  const pagination = getPagination(rawPage, limitItems, totalRecord);

  const orderList = await Order
    .find(find)
    .select("_id code total orderStatus paymentStatus paymentMethod createdAt")
    .sort({ createdAt: "desc" })
    .limit(limitItems)
    .skip(pagination.skip);

  return {
    orderList,
    pagination
  };
};

export const getOrderDetailForUser = async (userId: string, orderId: string) => {
  return Order.findOne({ _id: orderId, userId, deleted: false });
};

export const getOrderReviewData = async (userId: string, orderId: string) => {
  const orderDetail: IOrder | null = await Order.findOne({
    _id: orderId,
    userId,
    deleted: false
  });

  if (!orderDetail) return null;

  const itemIds = orderDetail.items.map((item) => item.id || String(item._id || ""));
  const reviews = await Review.find({ userId, orderItemId: { $in: itemIds } });
  const reviewMap = new Map(reviews.map((r) => [String(r.orderItemId), r]));
  for (const item of orderDetail.items) {
    const review = reviewMap.get(String(item.id || item._id || ""));
    if (review) item.review = review;
  }

  return orderDetail;
};

export const submitOrderReview = async (
  userId: string,
  orderId: string,
  orderItemId: string,
  rating: string | number,
  comment?: string,
  files?: Express.Multer.File[]
) => {
  const orderDetail: IOrder | null = await Order.findOne({
    _id: orderId,
    userId,
    deleted: false
  });

  if (!orderDetail) {
    return { success: false, status: 400, message: "Invalid data!" };
  }

  if (orderDetail.orderStatus !== "completed") {
    return { success: false, status: 409, message: "You can only review products from completed orders!" };
  }

  const orderItem = orderDetail.items.find((item: IOrderItem) => item.id === orderItemId);
  if (!orderItem) {
    return { success: false, status: 400, message: "Invalid data!" };
  }

  const productId = orderItem.productId;
  const variant = orderItem.variant;

  const existReview = await Review.findOne({
    userId,
    orderItemId
  }).select("_id");

  if (existReview) {
    return { success: false, status: 409, message: "You have already reviewed this product!" };
  }

  const maxImages = 5;
  if (files && files.length > maxImages) {
    return { success: false, status: 400, message: `You can only upload up to ${maxImages} images!` };
  }

  const maxSizePerImage = 5 * 1024 * 1024;
  if (files) {
    for (const file of files) {
      if (file.size > maxSizePerImage) {
        return { success: false, status: 400, message: `Each image must not exceed ${maxSizePerImage / (1024 * 1024)} MB!` };
      }
    }
  }

  let imageLinks: string[] = [];
  if (files && files.length > 0) {
    
    const uploads = await Promise.all(files.map((file) => fmUpload([file], `reviews/${userId}`)));
    const rejected = uploads.find((u) => !u.success);
    if (rejected) {
      return { success: false, status: upstreamStatus(rejected.status), message: rejected.message || "Upload error!" };
    }
    imageLinks = uploads.flatMap((u) => u.fileUrls);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const newReview = new Review({
        userId,
        orderId,
        orderItemId,
        productId,
        variant,
        rating: parseInt(`${rating}`),
        comment,
        images: imageLinks
      });
      await newReview.save({ session });

      const product = await Product.findOne({ _id: productId, deleted: false }, null, { session });
      if (product) {
        const newRatingCount = product.ratingCount + 1;
        const newRatingAvg = ((product.ratingAvg * product.ratingCount) + parseInt(`${rating}`)) / newRatingCount;
        product.ratingAvg = newRatingAvg;
        product.ratingCount = newRatingCount;
        await product.save({ session });
        if (product.slug) {
          invalidateProductCaches(product.slug);
        }
      }
    });
  } finally {
    session.endSession();
  }

  invalidateUserDashboardCache(userId);

  return { success: true, message: "Thank you for reviewing the product!" };
};
