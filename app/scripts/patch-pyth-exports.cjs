/**
 * @pythnetwork/pyth-solana-receiver ships an `exports` map with the
 * "default" condition before more specific ones, which webpack rejects
 * ("Default condition should be last one"). This postinstall hook reorders
 * every conditions object so "default" comes last. Runs locally and on
 * Vercel via the package.json `postinstall` script.
 */
const fs = require("fs");

let pkgPath;
try {
  pkgPath = require.resolve("@pythnetwork/pyth-solana-receiver/package.json");
} catch {
  console.log("patch-pyth-exports: package not installed, skipping");
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

function reorder(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  if (Object.prototype.hasOwnProperty.call(node, "default")) {
    const def = node.default;
    delete node.default;
    for (const key of Object.keys(node)) reorder(node[key]);
    node.default = def;
  } else {
    for (const key of Object.keys(node)) reorder(node[key]);
  }
}

if (pkg.exports) {
  reorder(pkg.exports);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log("patch-pyth-exports: reordered exports conditions");
}
