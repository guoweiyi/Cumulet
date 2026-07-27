import { cpSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextPackage = JSON.parse(readFileSync(join(root, "node_modules/next/package.json"), "utf8"));
const safePackagePath = join(root, "node_modules/postcss/package.json");
const bundledPath = join(root, "node_modules/next/node_modules/postcss");
const bundledPackagePath = join(bundledPath, "package.json");
const safePackage = JSON.parse(readFileSync(safePackagePath, "utf8"));
const bundledPackage = JSON.parse(readFileSync(bundledPackagePath, "utf8"));

const expected = {
  next: "16.2.12",
  bundledPostcss: "8.4.31",
  safePostcss: "8.5.23",
};

if (nextPackage.version !== expected.next || safePackage.version !== expected.safePostcss) {
  throw new Error(
    `Refusing dependency hardening for unreviewed versions: next=${nextPackage.version}, postcss=${safePackage.version}`,
  );
}

if (bundledPackage.version === expected.safePostcss) process.exit(0);
if (bundledPackage.version !== expected.bundledPostcss) {
  throw new Error(`Refusing to replace unexpected Next.js PostCSS ${bundledPackage.version}`);
}

rmSync(bundledPath, { recursive: true, force: true });
cpSync(join(root, "node_modules/postcss"), bundledPath, { recursive: true });
console.log(`[postinstall] replaced Next.js PostCSS ${expected.bundledPostcss} with ${expected.safePostcss}`);
