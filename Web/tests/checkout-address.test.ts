import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFile } from "pug";
import { resolve } from "node:path";

const view = resolve(__dirname, "../views/client/partials/checkout-form-area.pug");

test("guest checkout opens an empty delivery form", () => {
  const html = renderFile(view, { accountUser: null });
  assert.match(html, /class="accordion-collapse collapse show"/);
  assert.match(html, /name="fullName"[^>]*value=""/);
});

test("profile details prefill checkout when no default address exists", () => {
  for (const addressList of [[], [{ fullName: "Other recipient", isDefault: false }]]) {
    const html = renderFile(view, { accountUser: { fullName: "Profile name", phone: "0900000000", addressList } });
    assert.match(html, /class="accordion-collapse collapse show"/);
    assert.match(html, /name="fullName"[^>]*value="Profile name"/);
    assert.match(html, /name="phone"[^>]*value="0900000000"/);
  }
});

test("editing the default delivery address starts with its recipient and coordinates", () => {
  const html = renderFile(view, { accountUser: {
    fullName: "Profile name",
    addressList: [{ isDefault: true, fullName: "Recipient", phone: "0911111111", address: "Saved street", longitude: 106.7, latitude: 10.8 }]
  } });
  assert.match(html, /name="fullName"[^>]*value="Recipient"/);
  assert.match(html, /name="address"[^>]*value="Saved street"/);
  assert.match(html, /name="longitude"[^>]*value="106.7"/);
  assert.match(html, /name="latitude"[^>]*value="10.8"/);
});
