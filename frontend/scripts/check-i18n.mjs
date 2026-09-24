// Kiểm tra khoá i18n: mọi khoá tĩnh gọi qua t("...") / apiT("...") / xxxKey: "..."
// trong src phải có trong CẢ vi.json và en.json, và hai file phải có cùng tập khoá.
// Khoá động (template có ${...}) không kiểm tra được nên bỏ qua.
// Chạy: npm run check:i18n  (cũng chạy tự động trước `npm run build`)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const LOCALES = ["vi", "en"];

const dicts = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(src, "locales", `${l}.json`), "utf8"))])
);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "locales") yield* walk(p);
    } else if (/\.(jsx?|mjs)$/.test(name)) {
      yield p;
    }
  }
}

// Khoá luôn có dạng "nhom.ten[.ten...]"; nháy đóng phải trùng nháy mở (\1).
const patterns = [
  /\b(?:t|apiT)\(\s*(["'`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g,
  /\b\w*Key\s*:\s*(["'`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g,
];

const used = new Map(); // key -> "file:line" đầu tiên
for (const file of walk(src)) {
  const text = readFileSync(file, "utf8");
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      if (!used.has(m[2])) used.set(m[2], `${relative(root, file)}:${line}`);
    }
  }
}

let failed = false;

for (const l of LOCALES) {
  const missing = [...used].filter(([k]) => dicts[l][k] === undefined);
  if (missing.length) {
    failed = true;
    console.error(`\n[${l}.json] thiếu ${missing.length} khoá đang được dùng:`);
    for (const [k, where] of missing) console.error(`  ${k}   (${where})`);
  }
}

const [a, b] = LOCALES;
for (const [x, y] of [[a, b], [b, a]]) {
  const only = Object.keys(dicts[x]).filter((k) => dicts[y][k] === undefined);
  if (only.length) {
    failed = true;
    console.error(`\nCó trong ${x}.json nhưng thiếu ở ${y}.json (${only.length}):`);
    for (const k of only) console.error(`  ${k}`);
  }
}

if (failed) {
  console.error("\ncheck-i18n: FAIL");
  process.exit(1);
}
console.log(`check-i18n: OK (${used.size} khoá tĩnh, ${Object.keys(dicts[a]).length} khoá/ngôn ngữ)`);
