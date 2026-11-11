import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidWhatsapp, normalizeWhatsapp } from "./phone.js";
import { ticketTotal } from "./pricing.js";
import { allow } from "./ratelimit.js";
import { wibAt, wibDate, wibLabel } from "./time.js";

test("semua format nomor WhatsApp menghasilkan nomor yang sama", () => {
  for (const raw of ["0812-3456-7890", "+62 812 3456 7890", "6281234567890", "81234567890"]) {
    assert.equal(normalizeWhatsapp(raw), "081234567890", raw);
  }
});

test("validasi nomor WhatsApp", () => {
  assert.equal(isValidWhatsapp("081234567890"), true);
  assert.equal(isValidWhatsapp("12345"), false);
  assert.equal(isValidWhatsapp("0712345678901"), false);
});

test("harga tiket: Rp5.000 per orang + parkir", () => {
  assert.equal(ticketTotal(3, "none"), 15000);
  assert.equal(ticketTotal(2, "motor"), 13000);
  assert.equal(ticketTotal(1, "bus"), 25000);
});

test("tanggal WIB berganti pukul 17.00 UTC", () => {
  assert.equal(wibDate(new Date("2026-11-11T16:59:00Z")), "2026-11-11");
  assert.equal(wibDate(new Date("2026-11-11T17:00:00Z")), "2026-11-12");
  assert.equal(wibLabel(wibAt("2026-11-11", 10, 42)), "10.42");
});

test("pembatas permintaan: jendela geser", () => {
  const t0 = 1_000_000;
  assert.equal(allow("k", 2, 1000, t0), true);
  assert.equal(allow("k", 2, 1000, t0 + 10), true);
  assert.equal(allow("k", 2, 1000, t0 + 20), false);
  assert.equal(allow("lain", 2, 1000, t0 + 20), true); // kunci lain tidak terpengaruh
  assert.equal(allow("k", 2, 1000, t0 + 1100), true); // setelah jendela lewat
});
