// Proxy
const path = require('path');
const mochaDir = path.join(process.env.SLS_TDD_PLUGIN_TEST_DIR, '../', 'index.js');
module.exports = require(mochaDir);