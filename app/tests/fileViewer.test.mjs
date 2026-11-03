import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const moduleFrom = async (relative) => {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  const output = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
};

test("viewer resolver uses MIME, extension, then magic bytes", async () => {
  const { resolveViewer } = await moduleFrom("src/viewers/registry.ts");
  assert.equal(resolveViewer({ name: "no-extension", mime: "application/octet-stream" }, new Uint8Array([0x25, 0x50, 0x44, 0x46])).id, "pdf");
  assert.equal(resolveViewer({ name: "budget.xlsx", mime: "application/octet-stream" }).id, "spreadsheet");
  assert.equal(resolveViewer({ name: "analysis.ipynb", mime: "application/json" }).id, "notebook");
  assert.equal(resolveViewer({ name: "track.bin", mime: "audio/mpeg" }).id, "media");
  assert.equal(resolveViewer({ name: "stream.m3u8", mime: "application/vnd.apple.mpegurl" }).id, "media");
  assert.equal(resolveViewer({ name: "unknown.bin", mime: "application/octet-stream" }).id, "unknown");
});

test("viewer resolver covers the shipped file families", async () => {
  const { resolveViewer } = await moduleFrom("src/viewers/registry.ts");
  const cases = [
    ["brief.docx", "docx"], ["legacy.doc", "office"], ["slides.pptx", "office"],
    ["table.ods", "spreadsheet"], ["data.tsv", "spreadsheet"], ["notes.md", "markdown"],
    ["main.py", "text"], ["photo.heic", "image"], ["art.svg", "image"],
    ["album.flac", "media"], ["movie.mkv", "media"], ["backup.7z", "archive"],
    ["novel.epub", "ebook"], ["book.mobi", "ebook"], ["mesh.glb", "3d"],
    ["shape.stl", "3d"], ["typeface.woff2", "font"], ["message.eml", "email"],
    ["outlook.msg", "email"], ["lab.ipynb", "notebook"],
  ];
  for (const [name, expected] of cases) assert.equal(resolveViewer({ name, mime: "application/octet-stream" }).id, expected, name);
});

test("Jazper file links are source constrained and retain safe metadata", async () => {
  const { parseJazperFileLink } = await moduleFrom("src/lib/fileLinks.ts");
  const link = parseJazperFileLink("jazper://open?src=attachment&id=abc-brief.pdf&name=Brief.pdf&mime=application%2Fpdf&size=42&webUrl=https%3A%2F%2Fexample.com%2Fbrief");
  assert.deepEqual(link, { src: "attachment", id: "abc-brief.pdf", name: "Brief.pdf", mime: "application/pdf", size: 42, webUrl: "https://example.com/brief" });
  assert.equal(parseJazperFileLink("jazper://open?src=evil&id=file"), null);
  assert.equal(parseJazperFileLink("jazper://open?src=local"), null);
  assert.equal(parseJazperFileLink("https://example.com/?src=drive&id=x"), null);
});
