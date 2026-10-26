const require_version = require("./version-CQUNE4NI.cjs");
let node_stream = require("node:stream");
node_stream = require_version.__toESM(node_stream, 1);
let node_util = require("node:util");
node_util = require_version.__toESM(node_util, 1);
let node_crypto = require("node:crypto");
node_crypto = require_version.__toESM(node_crypto, 1);
let node_fs = require("node:fs");
node_fs = require_version.__toESM(node_fs, 1);
let node_child_process = require("node:child_process");
node_child_process = require_version.__toESM(node_child_process, 1);
let node_path = require("node:path");
node_path = require_version.__toESM(node_path, 1);
// node_modules/@anthropic-ai/sdk/internal/node.mjs
/**
* The one module under `src/` that may import Node built-ins (eslint enforces this).
* The package.json `browser` field swaps it for `./node.browser`, so only touch its
* exports on code paths that run on Node-compatible runtimes.
*/
var node_exports = /* @__PURE__ */ require_version.__exportAll({
	fs: () => node_fs,
	path: () => node_path
});
Object.defineProperty(exports, "node_exports", {
	enumerable: true,
	get: function() {
		return node_exports;
	}
});
