import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFromFacts } from "../data/knowledge.js";
import { matchFaq, tokens } from "./faq-match.js";

const faqs = [
  { question: "Jam buka Sumber Sira?", answer: "08-16", keywords: "operasional,tutup" },
  { question: "Berapa harga tiket masuk?", answer: "Rp5.000", keywords: "tarif" },
  { question: "Berapa biaya parkir?", answer: "motor 3rb", keywords: "parkir motor mobil bus" },
];

test("kata sambung dan nama tempat dibuang", () => {
  assert.deepEqual(tokens("Apakah Sumber Sira buka hari ini?"), ["buka", "hari"]);
});

test("pertanyaan beda susunan kata tetap cocok", () => {
  assert.equal(matchFaq("jam buka nya jam berapa kak", faqs)?.faq.answer, "08-16");
  assert.equal(matchFaq("harga tiketnya berapa?", faqs)?.faq.answer, "Rp5.000");
});

test("kata kunci tambahan ikut dicocokkan", () => {
  assert.equal(matchFaq("tutup jam berapa", faqs)?.faq.answer, "08-16");
});

test("satu kata yang kebetulan sama tidak cukup", () => {
  assert.equal(matchFaq("boleh bawa makanan dan tiket sendiri", faqs), null);
});

test("pertanyaan di luar FAQ tidak dipaksa cocok", () => {
  assert.equal(matchFaq("kalau hujan tetap buka?", faqs), null);
  assert.equal(matchFaq("", faqs), null);
});

test("jawaban cadangan dari kata kunci", () => {
  assert.match(answerFromFacts("parkir bus berapa?") ?? "", /Rp20\.000/);
  assert.match(answerFromFacts("jam buka weekend") ?? "", /08\.00-17\.00/);
  assert.equal(answerFromFacts("boleh bawa drone?"), null);
});

test("jawaban cadangan tidak menyesatkan karena satu kata umum", () => {
  assert.equal(answerFromFacts("boleh bawa drone ke kolam?"), null); // "kolam" saja bukan pertanyaan fasilitas
  assert.equal(answerFromFacts("spot foto yang teduh di mana?"), null); // bukan soal AI Photo Studio
  assert.equal(answerFromFacts("kalau hujan tetap buka?"), null); // kebijakan hujan tidak ada di data
  assert.match(answerFromFacts("tutup jam berapa?") ?? "", /16\.00/);
  assert.match(answerFromFacts("qris bisa?") ?? "", /QRIS/);
  assert.match(answerFromFacts("ai photo studio itu apa") ?? "", /Photo Studio/);
  assert.match(answerFromFacts("berapa biaya parkir bus") ?? "", /Rp20\.000/);
});
