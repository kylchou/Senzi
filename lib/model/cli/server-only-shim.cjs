// Lets CLI scripts import server modules: "server-only" throws outside a React
// server environment, so resolve it to an empty module (as tests/support does).
// Loaded with `node --require`, so it has to be CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("node:module");
const path = require("node:path");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return path.resolve(__dirname, "../../../tests/support/server-only.ts");
  return original.call(this, request, ...rest);
};
