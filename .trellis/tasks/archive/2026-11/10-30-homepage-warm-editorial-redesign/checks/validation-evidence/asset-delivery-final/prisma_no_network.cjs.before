/* eslint-disable @typescript-eslint/no-require-imports -- Diagnostic-only preload forbids automatic engine downloads. */
const net = require("node:net");
const { syncBuiltinESMExports } = require("node:module");

function denyConnection() {
  throw Object.assign(new Error("Prisma diagnostic cannot open network connections or download engines"), {
    code: "HOMEPAGE_CHECK_NETWORK_DISABLED",
  });
}

net.connect = denyConnection;
net.createConnection = denyConnection;
net.Socket.prototype.connect = denyConnection;
globalThis.fetch = async () => denyConnection();
syncBuiltinESMExports();
