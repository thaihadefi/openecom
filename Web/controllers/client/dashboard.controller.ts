import { Request, Response } from 'express';
import * as dashboardService from '../../services/client/dashboard.service';
import { resultStatus, sendCaughtError } from "../../helpers/http-response.helper";
import { COOKIE_OPTS } from "../../configs/cookie.config";

export const dashboard = async (_req: Request, res: Response) => {
  const userId = res.locals.accountUser.id;
  const data = await dashboardService.getDashboardOverview(userId);

  res.render("client/pages/dashboard", {
    pageTitle: "Overview",
    ...data
  });
};

export const profile = (_req: Request, res: Response) => {
  res.render("client/pages/dashboard-profile", {
    pageTitle: "Profile"
  });
};

export const profileEdit = (_req: Request, res: Response) => {
  res.render("client/pages/dashboard-profile-edit", {
    pageTitle: "Edit Profile"
  });
};

export const profileEditPatch = async (req: Request, res: Response) => {
  try {
    const id = res.locals.accountUser.id;
    const currentEmail = res.locals.accountUser.email;

    const result = await dashboardService.updateProfile(
      id,
      currentEmail,
      req.body.fullName,
      req.body.phone
    );

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("profileEditPatch error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const changeEmailRequestPost = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const oldEmail = res.locals.accountUser.email;
    const { newEmail } = req.body;

    const result = await dashboardService.requestChangeEmail(userId, oldEmail, newEmail);

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("changeEmailRequestPost error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const changeEmailVerifyPost = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const { otp } = req.body;

    const result = await dashboardService.verifyChangeEmail(
      userId,
      res.locals.accountUser.fullName,
      res.locals.accountUser.phone,
      otp
    );

    if (result.success) {
      res.clearCookie("tokenUser", COOKIE_OPTS);
      res.clearCookie("refreshToken", COOKIE_OPTS);
    }

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("changeEmailVerifyPost error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const changePassword = (_req: Request, res: Response) => {
  res.redirect("/auth/forgot-password");
};

export const address = async (_req: Request, res: Response) => {
  const id = res.locals.accountUser.id;
  const addressList = await dashboardService.getUserAddresses(id);

  res.render("client/pages/dashboard-address", {
    pageTitle: "Address List",
    addressList: addressList
  });
};

export const addressCreate = (_req: Request, res: Response) => {
  res.render("client/pages/dashboard-address-create", {
    pageTitle: "Add Address"
  });
};

export const addressCreatePost = async (req: Request, res: Response) => {
  try {
    const id = res.locals.accountUser.id;
    const result = await dashboardService.createUserAddress(id, req.body);

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("addressCreatePost error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const addressChangeDefaultPatch = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const addressId = req.params.id;

    const result = await dashboardService.setDefaultUserAddress(userId, addressId);

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("addressChangeDefaultPatch error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const addressDelete = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const addressId = req.params.id;

    const result = await dashboardService.deleteUserAddress(userId, addressId);

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("addressDelete error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const addressEdit = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const addressId = req.params.id;

    const addressDetail = await dashboardService.getUserAddressDetail(userId, addressId);

    if (!addressDetail) {
      res.redirect(`/dashboard/address`);
      return;
    }

    res.render("client/pages/dashboard-address-edit", {
      pageTitle: "Edit Address",
      addressDetail: addressDetail
    });
  } catch (error) {
    res.redirect(`/dashboard/address`);
  }
};

export const addressEditPatch = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const addressId = req.params.id;

    const result = await dashboardService.updateUserAddress(userId, addressId, req.body);

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("addressEditPatch error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const profileChangeAvatarPatch = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const file = req.file;

    if (!file) {
      res.status(400).json({
        code: "error",
        message: "Please select a file!"
      });
      return;
    }

    const result = await dashboardService.updateAvatar(userId, file, res.locals.accountUser.avatar);

    if (result.success) {
      res.json({
        code: "success",
        message: result.message,
        linkAvatar: result.linkAvatar
      });
    } else {
      res.status(resultStatus(result)).json({
        code: "error",
        message: result.message
      });
    }
  } catch (error) {
    console.error("profileChangeAvatarPatch error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};

export const orderList = async (req: Request, res: Response) => {
  const id = res.locals.accountUser.id;
  const data = await dashboardService.getOrderHistory(id, req.query.page);

  res.render("client/pages/dashboard-order-list", {
    pageTitle: "Order History",
    ...data
  });
};

export const orderDetail = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const orderId = req.params.id;

    const orderDetail = await dashboardService.getOrderDetailForUser(userId, orderId);

    if (!orderDetail) {
      res.redirect('/dashboard/order/list');
      return;
    }

    res.render("client/pages/dashboard-order-detail", {
      pageTitle: `Order Details: ${orderDetail.code}`,
      orderDetail: orderDetail
    });
  } catch (error) {
    res.redirect('/dashboard/order/list');
  }
};

export const orderReview = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const orderId = req.params.id;

    const orderDetail = await dashboardService.getOrderReviewData(userId, orderId);

    if (!orderDetail || orderDetail.orderStatus !== "completed") {
      res.redirect('/dashboard/order/list');
      return;
    }

    res.render("client/pages/dashboard-order-review", {
      pageTitle: `Review Order: ${orderDetail.code}`,
      orderDetail: orderDetail
    });
  } catch (error) {
    res.redirect('/dashboard/order/list');
  }
};

export const orderReviewPost = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.accountUser.id;
    const { orderId, orderItemId, rating, comment } = req.body;
    const files = req.files as Express.Multer.File[];

    const result = await dashboardService.submitOrderReview(
      userId,
      orderId,
      orderItemId,
      rating,
      comment,
      files
    );

    res.status(resultStatus(result)).json({
      code: result.success ? "success" : "error",
      message: result.message
    });
  } catch (error) {
    console.error("orderReviewPost error:", error);
    sendCaughtError(res, error, "Invalid data!");
  }
};
