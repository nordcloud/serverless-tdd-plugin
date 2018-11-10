const Mocha = require('mocha');
const chai = require('chai');
const utils = require('./utils');

class TestRunner {
  constructor() {
    this.mocha = new Mocha({
      timeout: 6000,
    });
  }
  
  addFile(path) {
    return this.mocha.addFile(path);
  };
  
  reporter(reporter, reporterOptions) {
    return this.mocha.reporter(reporter, reporterOptions);
  };
  
  grep(grepOption) {
    return this.mocha.grep(grepOption);
  }
  
  getChai() {
    return chai;
  }

  run(myModule, testFileMap, options) {
    const mochaRunner = this.mocha.run((failures) => {
      process.on('exit', () => {
        myModule.runScripts('postTestCommands')
          // exit with non-zero status if there were failures
        .then(() => process.exit(failures));
      });
    }).on('test', (suite) => {
      const testFuncName = utils.funcNameFromPath(suite.file);
      // set env only for functions
      if (testFileMap[testFuncName]) {
        utils.setEnv(myModule.serverless, testFuncName);
      } else {
        utils.setEnv(myModule.serverless);
      }
    });
  
    if (options.exit) {
      mochaRunner.on('end', process.exit);
    }
  }
}

module.exports = TestRunner;