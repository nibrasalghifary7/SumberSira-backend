import assert from "node:assert/strict";
import { test } from "node:test";
import { crowdLabel, hourly, insideAt, summarize, timeline, toPercent, type CrowdTicket } from "./crowd.js";
import { wibAt } from "./time.js";

const D = "2026-11-11";
const at = (h: number, m = 0) => wibAt(D, h, m);
const ticket = (people: number, inH: number | null, outH: number | null): CrowdTicket => ({
  people,
  status: inH === null ? "waiting" : outH === null ? "inside" : "out",
  checkInAt: inH === null ? null : at(inH),
  checkOutAt: outH === null ? null : at(outH),
});

test("check-in menaikkan, check-out menurunkan", () => {
  const t = [ticket(4, 9, 11), ticket(2, 10, null)];
  assert.equal(insideAt(t, at(8, 59)), 0);
  assert.equal(insideAt(t, at(9)), 4);
  assert.equal(insideAt(t, at(10, 30)), 6);
  assert.equal(insideAt(t, at(11)), 2); // yang keluar tepat 11.00 sudah tidak dihitung
});

test("tiket yang belum discan tidak menaikkan grafik", () => {
  assert.equal(insideAt([ticket(5, null, null)], at(12)), 0);
});

test("ringkasan memakai status tiket", () => {
  const s = summarize([ticket(3, 9, null), ticket(2, 9, 10), ticket(4, null, null)]);
  assert.equal(s.inside, 3);
  assert.equal(s.out, 2);
  assert.equal(s.waiting, 4);
  assert.equal(s.sold, 3);
  assert.equal(s.percent, 1);
  assert.equal(s.label, "Sepi");
});

test("label keramaian: <40 Sepi, sampai 75 Sedang, selebihnya Ramai", () => {
  assert.equal(crowdLabel(39), "Sepi");
  assert.equal(crowdLabel(40), "Sedang");
  assert.equal(crowdLabel(75), "Sedang");
  assert.equal(crowdLabel(76), "Ramai");
});

test("persen dibatasi 0 sampai 100", () => {
  assert.equal(toPercent(150), 50);
  assert.equal(toPercent(300), 100);
  assert.equal(toPercent(999), 100);
});

test("timeline berisi titik tiap 30 menit dan titik terakhir = sekarang", () => {
  const now = at(10, 20);
  const pts = timeline([ticket(3, 9, null)], D, now);
  assert.deepEqual(
    pts.map((p) => p.label),
    ["08.00", "08.30", "09.00", "09.30", "10.00", "10.20"],
  );
  assert.deepEqual(
    pts.map((p) => p.inside),
    [0, 0, 3, 3, 3, 3],
  );
});

test("timeline sebelum buka kosong", () => {
  assert.deepEqual(timeline([], D, at(7, 30)), []);
});

test("check-out langsung terlihat di titik sekarang", () => {
  const t = [{ ...ticket(3, 9, null), status: "out" as const, checkOutAt: at(10, 15) }];
  const pts = timeline(t, D, at(10, 16));
  assert.equal(pts[pts.length - 1].inside, 0);
  assert.equal(pts[pts.length - 2].inside, 3); // 10.00 masih ada di dalam
});

test("puncak per jam menangkap pengunjung yang masuk lalu keluar di jam yang sama", () => {
  const t = [ticket(10, 9, 10)];
  const h = hourly(t, D, at(12));
  assert.equal(h.find((x) => x.hour === 9)?.peak, 10);
  assert.equal(h.find((x) => x.hour === 10)?.peak, 0);
  assert.equal(h.length, 5); // 08, 09, 10, 11, 12
});
