import { Router } from "express";
import * as chatController from "../../controllers/client/chat.controller";
import * as authMiddleware from "../../middlewares/client/auth.middleware";
import { chatUpload } from "../../helpers/upload.helper";

export const sessionStateApi = Router();

sessionStateApi.get('/current', chatController.session);

export const chatApi = Router();

chatApi.get('/current/messages', authMiddleware.loggedIn, chatController.messages);

chatApi.post(
  '/current/attachments',
  authMiddleware.loggedIn,
  chatUpload.array("files"),
  chatController.uploadPost
);

chatApi.put('/current/rating', authMiddleware.loggedIn, chatController.ratePost);
