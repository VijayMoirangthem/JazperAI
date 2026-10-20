import test from "node:test";
import assert from "node:assert/strict";
import { slugify, validateEmployee, SLUG_RE } from "../src/office2/forms.ts";

test("slugify", () => {
  assert.equal(slugify("Forge Bot 2"), "forge-bot-2");
  assert.equal(slugify("  Åsa & Co. "), "sa-co");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("a".repeat(60)).length, 40);
  assert.equal(slugify("ab-" + "c".repeat(60)).endsWith("-"), false);
  assert.ok(SLUG_RE.test(slugify("QA Sim Bot")));
});

const ok = { slug: "qa-bot", name: "QA Bot", role: "Tester", crew: "baeit", prompt: "You are QA Bot." };

test("validateEmployee: a good form passes in both modes", () => {
  assert.equal(validateEmployee(ok, ["forge"], "add"), null);
  assert.equal(validateEmployee(ok, ["qa-bot"], "edit"), null);
});

test("validateEmployee: first problem wins, with a readable sentence", () => {
  assert.equal(validateEmployee({ ...ok, name: "  " }, [], "add"), "Name is required.");
  assert.match(validateEmployee({ ...ok, slug: "A" }, [], "add"), /^Slug must be/);
  assert.match(validateEmployee({ ...ok, slug: "-x" }, [], "add"), /^Slug must be/);
  assert.equal(validateEmployee(ok, ["qa-bot"], "add"), "That slug is already taken.");
  assert.equal(validateEmployee({ ...ok, role: "" }, [], "add"), "Role is required.");
  assert.equal(validateEmployee({ ...ok, crew: "" }, [], "add"), "Crew is required.");
  assert.equal(validateEmployee({ ...ok, prompt: " " }, [], "add"), "Prompt is required.");
});
