import { Router } from "express";
import * as orderController from "../../controllers/admin/order.controller";
import { checkAnyPermission, checkPermission } from "../../middlewares/admin/auth.middleware";
import { requireFeature } from "../../middlewares/feature.middleware";
import { textForm } from "../../helpers/upload.helper";

import { permanentOnly } from "../../helpers/rest.helper";
const router = Router();

router.get('/list', checkAnyPermission("order-edit", "order-delete"), orderController.list);
router.get('/flagged', checkPermission("order-edit"), requireFeature("ML_FRAUD_DETECTION"), orderController.flaggedList);
router.get('/trash', checkAnyPermission("order-edit", "order-delete"), orderController.trash);
router.get('/edit/:id', checkAnyPermission("order-edit", "order-delete"), orderController.edit);

export default router;

export const api = Router();

api.delete('/:id', permanentOnly, checkPermission("order-delete"), orderController.destroyDelete);

api.patch('/:id', checkPermission("order-edit"), textForm.none(), orderController.editPatch);

api.post('/:id/restore', checkPermission("order-edit"), orderController.undoPatch);

api.post('/restore', checkPermission("order-edit"), orderController.undoManyPatch);

api.post('/trash', checkPermission("order-delete"), orderController.deleteManyPatch);

api.delete('/', checkPermission("order-delete"), orderController.destroyManyDelete);

api.delete('/:id', checkPermission("order-delete"), orderController.deletePatch);

export const flaggedApi = Router();

flaggedApi.post('/retraining', checkPermission("order-edit"), orderController.retrainAnomalyModelPost);

flaggedApi.get('/retraining', checkPermission("order-edit"), orderController.retrainAnomalyModelStatus);

flaggedApi.delete('/:id', checkPermission("order-edit"), orderController.dismissAnomalyPost);

api.get('/csv', checkPermission("order-edit"), orderController.exportCSV);
