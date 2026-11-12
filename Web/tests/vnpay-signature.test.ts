import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { signVNPayParams } from "../services/payment/vnpay.service";

const SECRET = "TEST_SECRET";
const params = { vnp_Amount: "1500000", vnp_TxnRef: "0912345678-DM123456", vnp_ResponseCode: "00" };

test("signs with HMAC-SHA512 over the parameters sorted by key", () => {
  const expected = crypto
    .createHmac("sha512", SECRET)
    .update("vnp_Amount=1500000&vnp_ResponseCode=00&vnp_TxnRef=0912345678-DM123456")
    .digest("hex");
  assert.equal(signVNPayParams(params, SECRET), expected);
});

test("the signature does not depend on parameter order", () => {
  const reordered = { vnp_ResponseCode: "00", vnp_TxnRef: "0912345678-DM123456", vnp_Amount: "1500000" };
  assert.equal(signVNPayParams(reordered, SECRET), signVNPayParams(params, SECRET));
});

test("a changed amount or a different secret changes the signature", () => {
  const original = signVNPayParams(params, SECRET);
  assert.notEqual(signVNPayParams({ ...params, vnp_Amount: "100" }, SECRET), original);
  assert.notEqual(signVNPayParams(params, "OTHER_SECRET"), original);
});
