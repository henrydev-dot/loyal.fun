/**
 * Node require-hook that stubs out `jito-ts` (pulled in by
 * @pythnetwork/solana-utils but never used by our scripts). Its subtree
 * ships broken ESM paths and an ancient nested web3.js whose
 * `rpc-websockets` subpath imports crash under modern Node.
 *
 * Usage: NODE_OPTIONS="--require ./scripts/stub-jito.cjs" npx ts-node …
 * (seed_demo.ts sets this up automatically via its npm script.)
 */
const Module = require("module");
const path = require("path");

const stubPath = path.join(__dirname, "stub-jito-empty.cjs");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
  if (request === "jito-ts" || request.startsWith("jito-ts/")) {
    return stubPath;
  }
  return original.call(this, request, ...args);
};
