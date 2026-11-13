import mongoose from "mongoose";

// A carrier booking that still has to be cancelled because the first attempt failed.
// The shipment-cancel job retries it until the carrier confirms, then deletes it.
const schema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    externalId: { type: String, required: true },
    status: { type: String, enum: ["pending", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastError: String,
  },
  { timestamps: true }
);

schema.index({ provider: 1, externalId: 1 }, { unique: true });
schema.index({ status: 1, nextAttemptAt: 1 });

const ShipmentCancelTask = mongoose.model("ShipmentCancelTask", schema, "shipment-cancel-tasks");

export default ShipmentCancelTask;
