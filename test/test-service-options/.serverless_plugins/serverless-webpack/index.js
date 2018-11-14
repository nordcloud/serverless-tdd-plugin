// Proxy
const path = require('path');
const webpackDir = path.join(process.env.SLS_TDD_PLUGIN_TEST_DIR, '../', 'node_modules', 'serverless-webpack');
module.exports = require(webpackDir);