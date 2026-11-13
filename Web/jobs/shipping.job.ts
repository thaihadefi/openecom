import { scheduleJob } from "./scheduler";
import { retryShipmentCancels } from "../services/shipping/shipping.service";

// Carrier bookings whose cancellation failed are retried until the carrier confirms.
export const autoRetryShipmentCancels = () => {
  scheduleJob("retry-shipment-cancels", "*/10 * * * *", async () => {
    try {
      const { cancelled, failed } = await retryShipmentCancels();
      if (cancelled || failed) console.log(`[Shipping] Retried cancellations: ${cancelled} cancelled, ${failed} handed to staff`);
    } catch (error: unknown) {
      console.error("[Shipping] Retrying shipment cancellations failed:", error instanceof Error ? error.message : error);
    }
  });
};
