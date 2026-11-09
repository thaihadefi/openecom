import mongoose from 'mongoose';
import AccountUser from '../../models/account-user.model';
import UserAddress from '../../models/user-address.model';
import ChatRoom from '../../models/chat-room.model';
import Review from '../../models/review.model';
import Product from '../../models/product.model';
import ChatMessage from '../../models/chat-message.model';
import RefreshToken from '../../models/refresh-token.model';
import { fmDeleteFolder } from '../../helpers/file-manager.client';
import { softDeleteMany, restoreMany, getTrash } from "../../helpers/admin-crud.helper";
import { paginatedSearch } from "../../helpers/list-query.helper";
import { invalidateUserAuthCache } from "../client/auth.service";
import { invalidateUserDashboardCache } from "../client/dashboard.service";
import { invalidateProductCaches } from "../../helpers/metadata-cache.helper";
import { invalidateAdminDashboardCaches } from "./dashboard.service";
import { invalidateRoomList, invalidateUserRoom, invalidateUnread, invalidateRoomStatus } from "../../helpers/chat-cache.helper";

const removeUserMedia = (userIds: string[]): void => {
  userIds.forEach((userId) => {
    ["users", "chats", "reviews"].forEach((area) => fmDeleteFolder(`/media/${area}/${userId}`));
  });
};

export const getUserAccountList = async (rawKeyword?: unknown, rawPage?: unknown) => {
  const { recordList, pagination } = await paginatedSearch(AccountUser, rawKeyword, rawPage, { select: "-password -search", fields: ["search", "phone"] });

  return {
    recordList,
    pagination
  };
};

export const softDeleteUserAccount = async (id: string) => {
  await AccountUser.updateOne({ _id: id }, { deleted: true, deletedAt: new Date() });
  invalidateUserAuthCache(id);
  invalidateUserDashboardCache(id);
  invalidateAdminDashboardCaches();
  return { success: true, message: "User deleted successfully!" };
};

export const softDeleteManyUserAccounts = (ids: string[]) => {
  ids.forEach((id) => {
    invalidateUserAuthCache(id);
    invalidateUserDashboardCache(id);
  });
  invalidateAdminDashboardCaches();
  return softDeleteMany(AccountUser, ids, "user");
};

export const restoreUserAccount = async (id: string) => {
  await AccountUser.updateOne({ _id: id }, { deleted: false });
  invalidateUserAuthCache(id);
  invalidateUserDashboardCache(id);
  invalidateAdminDashboardCaches();
  return { success: true, message: "Restored successfully!" };
};

export const restoreManyUserAccounts = (ids: string[]) => {
  ids.forEach((id) => {
    invalidateUserAuthCache(id);
    invalidateUserDashboardCache(id);
  });
  invalidateAdminDashboardCaches();
  return restoreMany(AccountUser, ids, "user");
};

const deleteUserReviews = async (userIds: string[], session: mongoose.ClientSession) => {
  const userFilter = { userId: { $in: userIds } };
  const productIds: string[] = await Review.distinct("productId", userFilter).session(session);
  await Review.deleteMany(userFilter, { session });
  if (productIds.length === 0) return;

  const remaining = await Review.aggregate<{ _id: string; count: number; avg: number }>([
    { $match: { productId: { $in: productIds } } },
    { $group: { _id: "$productId", count: { $sum: 1 }, avg: { $avg: "$rating" } } }
  ]).session(session);
  const stats = new Map(remaining.map(item => [String(item._id), item]));
  for (const productId of productIds) {
    const stat = stats.get(String(productId));
    await Product.updateOne({ _id: productId }, {
      ratingCount: stat?.count || 0,
      ratingAvg: stat?.avg || 0
    }, { session });
  }
};

export const permanentlyDeleteUserAccount = async (id: string) => {
  const userId = String(id);
  const rooms = await ChatRoom.find({ userId }).select("_id adminId userId");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // A MongoDB session must execute transaction operations sequentially.
      await AccountUser.deleteOne({ _id: userId }, { session });
      await UserAddress.deleteMany({ userId }, { session });
      await ChatRoom.deleteMany({ userId }, { session });
      await deleteUserReviews([userId], session);
      await ChatMessage.deleteMany({ roomId: { $in: rooms.map((room) => room._id.toString()) } }, { session });
      await RefreshToken.deleteMany({ userId, role: "user" }, { session });
    });
  } finally {
    session.endSession();
  }

  removeUserMedia([userId]);

  rooms.forEach((room) => {
    if (room.adminId) invalidateRoomList(room.adminId);
    if (room.userId) invalidateUserRoom(room.userId);
    invalidateUnread(room._id.toString(), room.userId);
    invalidateRoomStatus(room._id.toString());
  });

  invalidateUserAuthCache(userId);
  invalidateUserDashboardCache(userId);
  invalidateProductCaches();
  invalidateAdminDashboardCaches();
  return { success: true, message: "Deleted permanently!" };
};

export const permanentlyDeleteManyUserAccounts = async (ids: string[]) => {
  const userIds = ids.map(String);
  const rooms = await ChatRoom.find({ userId: { $in: userIds } }).select("_id adminId userId");

  let deletedCount = 0;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const deleted = await AccountUser.deleteMany({ _id: { $in: ids } }, { session });
      await UserAddress.deleteMany({ userId: { $in: userIds } }, { session });
      await ChatRoom.deleteMany({ userId: { $in: userIds } }, { session });
      await deleteUserReviews(userIds, session);
      await ChatMessage.deleteMany({ roomId: { $in: rooms.map((room) => room._id.toString()) } }, { session });
      await RefreshToken.deleteMany({ userId: { $in: userIds }, role: "user" }, { session });
      deletedCount = deleted.deletedCount;
    });
  } finally {
    session.endSession();
  }

  removeUserMedia(userIds);

  rooms.forEach((room) => {
    if (room.adminId) invalidateRoomList(room.adminId);
    if (room.userId) invalidateUserRoom(room.userId);
    invalidateUnread(room._id.toString(), room.userId);
    invalidateRoomStatus(room._id.toString());
  });

  ids.forEach((id) => {
    invalidateUserAuthCache(id);
    invalidateUserDashboardCache(id);
  });
  invalidateProductCaches();
  invalidateAdminDashboardCaches();
  return { success: true, message: `Deleted ${deletedCount} user account(s) permanently!` };
};

export const getUserAccountTrash = () => getTrash(AccountUser, "_id fullName email phone status deletedAt");
