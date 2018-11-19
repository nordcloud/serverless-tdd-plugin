'use strict';

/**
 * serverless-tdd-plugin
 * - a plugin for TDD with Serverless Framework
 */

const path = require('path');
const lambdaWrapper = require('lambda-wrapper');
const ejs = require('ejs');
const fse = require('fs-extra');
const utils = require('./utils');
const BbPromise = require('bluebird');
const yamlEdit = require('yaml-edit');
const execSync = require('child_process').execSync;
//const testTemplateFile = path.join('templates', 'test-template.ejs');

// TODO: base supported runtimes on available templates

const validFunctionRuntimes = [
  'aws-nodejs4.3',
  'aws-nodejs6.10',
  'aws-nodejs8.10',
];

const humanReadableFunctionRuntimes = `${validFunctionRuntimes
  .map(template => `"${template}"`).join(', ')}`;

class mochaPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.testRunner = null;

    this.commands = {
      create: {
        commands: {
          test: {
            usage: 'Create mocha tests for service / function',
            lifecycleEvents: [
              'test',
            ],
            options: {
              function: {
                usage: 'Name of the function',
                shortcut: 'f',
                required: true,
              },
              path: {
                usage: 'Path for the tests',
                shortcut: 'p',
              },
            },
          },
          function: {
            usage: 'Create a function into the service',
            lifecycleEvents: [
              'create',
            ],
            options: {
              function: {
                usage: 'Name of the function',
                shortcut: 'f',
                required: true,
              },
              handler: {
                usage: 'Handler for the function (e.g. --handler my-function/index.handler)',
                required: true,
              },
              path: {
                usage: 'Path for the tests (e.g. --path tests)',
                shortcut: 'p',
              },
              httpEvent: {
                usage: 'Add an http endpoint (e.g. --httpEvent "verb relative-path")',
              },
            },
          },
        },
      },
      invoke: {
        usage: 'Invoke mocha tests for service / function',
        commands: {
          test: {
            usage: 'Invoke test(s)',
            lifecycleEvents: [
              'test',
            ],
            options: {
              function: {
                usage: 'Name of the function',
                shortcut: 'f',
              },
              reporter: {
                usage: 'Reporter to use (mocha)',
                shortcut: 'R',
              },
              'reporter-options': {
                usage: 'Options for reporter (mocha)',
                shortcut: 'O',
              },
              grep: {
                usage: 'Run only matching tests',
                shortcut: 'G',
              },
              live: {
                usage: 'Run the Lambda function in AWS',
                shortcut: 'l',
              },
              root: {
                usage: 'Service root for running tests',
                shortcut: 'r',
              },
              path: {
                usage: 'Path for the tests for running tests in other than default "test" folder',
              },
              compilers: {
                usage: 'Compiler to use (mocha)',
              },
              exit: {
                usage: 'force shutdown of the event loop after test run',
              },
            },
          },
        },
      },
    };

    this.hooks = {
      'create:test:test': () => {
        BbPromise.bind(this)
          .then(this.createTest);
      },
      'invoke:test:test': () => {
        BbPromise.bind(this)
          .then(this.runTests);
      },
      'create:function:create': () => {
        BbPromise.bind(this)
          .then(this.createFunction)
          .then(this.createTest);
      },
    };
  }

  // Run pre/postTest scriprs
  runScripts(testStage) {
    const myModule = this;
    return new Promise((succeed) => {
      const cmds = myModule.config[testStage] || [];
      cmds.forEach((cmd) => {
        this.serverless.cli.log(`Run command: ${cmd}`);
        const cmdOut = execSync(cmd);
        if (process.env.SLS_DEBUG) {
          const output = new Buffer(cmdOut, 'base64').toString();
          this.serverless.cli.log(output);
        }
      });
      succeed();
    });
  }

  runTests() {
    const myModule = this;
    const funcOption = this.options.f || this.options.function || [];
    const testsPath = this.options.p || this.options.path || utils.getTestsFolder();
    const testFileMap = {};

    const stage = this.options.stage;
    const region = this.options.region;

    let funcNames = [];
    if (typeof funcOption === 'string') {
      funcNames = [funcOption];
    } else if (funcOption.length > 0) {
      funcNames = funcOption;
    }
    this.serverless.service.load({
      stage,
      region,
    })
      .then((inited) => {
        myModule.config = (inited.custom || {})['serverless-tdd-plugin'] || {};
        // Verify that the service runtime matches with the current runtime
        let nodeVersion;
        if (typeof process.versions === 'object') {
          nodeVersion = process.versions.node;
        } else {
          nodeVersion = process.versions;
        }
        this.initRunner(myModule.config);

        nodeVersion = nodeVersion.replace(/\.[^.]*$/, '');
        if (`nodejs${nodeVersion}` !== inited.provider.runtime) {
          let errorMsg = `Tests being run with nodejs${nodeVersion}, `;
          errorMsg = `${errorMsg} service is using ${inited.provider.runtime}.`;
          errorMsg = `${errorMsg} Tests may not be reliable.`;

          this.serverless.cli.log(errorMsg);
        }

        myModule.serverless.environment = inited.environment;
        const vars = new myModule.serverless.classes.Variables(myModule.serverless);
        vars.populateService(this.options)
          .then(() => myModule.runScripts('preTestCommands'))
          .then(() => myModule.getFunctions(funcNames))
          .then((funcs) => utils.getTestFiles(funcs, testsPath, funcNames))
          .then((funcs) => {
            // Run the tests that were actually found
            funcNames = Object.keys(funcs);
            if (funcNames.length === 0) {
              return myModule.serverless.cli.log('No tests to run');
            }

            funcNames.forEach((func) => {
              if (funcs[func].tddPlugin) {
                if (funcs[func].handler) {
                    // Map only functions
                  testFileMap[func] = funcs[func];
                  utils.setEnv(this.serverless, func);
                } else {
                  utils.setEnv(this.serverless);
                }

                const testPath = funcs[func].tddPlugin.testPath;

                if (fse.existsSync(testPath)) {
                  console.log('ADD ' + testPath);
                  this.testRunner.addFile(testPath);
                }
              }
            });

            const reporter = myModule.options.reporter;

            if (reporter !== undefined) {
              const reporterOptions = {};
              if (myModule.options['reporter-options'] !== undefined) {
                myModule.options['reporter-options'].split(',').forEach((opt) => {
                  const L = opt.split('=');
                  if (L.length > 2 || L.length === 0) {
                    throw new Error(`invalid reporter option "${opt}"`);
                  } else if (L.length === 2) {
                    reporterOptions[L[0]] = L[1];
                  } else {
                    reporterOptions[L[0]] = true;
                  }
                });
              }
              this.testRunner.reporter(reporter, reporterOptions);
            }

            if (myModule.options.grep) {
              this.testRunner.grep(myModule.options.grep);
            }

            // set the SERVERLESS_TEST_ROOT variable to define root for tests
            let rootFolder = this.serverless.config.servicePath;

            if (myModule.options.root) {
              rootFolder = myModule.options.root;
              myModule.serverless.cli.log(`Run tests against code under '${rootFolder}'`);
            }

            // Use full paths to ensure that the code is correctly required in tests
            if (!path.isAbsolute(rootFolder)) {
              const currDir = process.cwd();
              rootFolder = path.join(currDir, rootFolder);
            }

            /* eslint-disable dot-notation */
            process.env['SERVERLESS_TEST_ROOT'] = rootFolder;

            if (myModule.options.live) {
              process.env['SERVERLESS_TDD_PLUGIN_LIVE'] = true;
              process.env['SERVERLESS_TDD_PLUGIN_REGION'] = region || inited.provider.region;
              process.env['SERVERLESS_TDD_PLUGIN_SERVICE'] = inited.service;
              process.env['SERVERLESS_TDD_PLUGIN_STAGE'] = stage || inited.provider.stage;
            }
            /* eslint-enable dot-notation */

            const compilers = myModule.options.compilers;
            if (typeof compilers !== 'undefined') {
              const extensions = ['js'];
              myModule.options.compilers.split(',').filter(e => e !== '').forEach(c => {
                const split = c.split(/:(.+)/);
                const ext = split[0];
                let mod = split[1];

                if (mod[0] === '.') {
                  mod = path.join(process.cwd(), mod);
                }
                require(mod); // eslint-disable-line global-require
                extensions.push(ext);
              });
            }

            this.testRunner.run(myModule, myModule.options, testFileMap);

            return null;
          }, error => myModule.serverless.cli.log(error));
      });
  }

  createTest() {
    const funcName = this.options.f || this.options.function;
    const testsRootFolder = this.options.p || this.options.path;
    const myModule = this;
    
    utils.createTestFolder(testsRootFolder).then(() => {
      const testFilePath = utils.getTestFilePath(funcName, testsRootFolder);
      const func = myModule.serverless.service.functions[funcName];
      const handlerParts = func.handler.split('.');
      const funcPath = (`${handlerParts[0]}.js`).replace(/\\/g, '/');
      const handler = handlerParts[handlerParts.length - 1];

      fse.exists(testFilePath, (exists) => {
        if (exists) {
          myModule.serverless.cli.log(`Test file ${testFilePath} already exists`);
          return (new Error(`File ${testFilePath} already exists`));
        }

        let templateFilenamePath = '';

        if (this.serverless.service.custom &&
          this.serverless.service.custom['serverless-tdd-plugin'] &&
          this.serverless.service.custom['serverless-tdd-plugin'].testTemplate) {
          templateFilenamePath = path.join(this.serverless.config.servicePath,
            this.serverless.service.custom['serverless-tdd-plugin'].testTemplate);
        }
        fse.exists(templateFilenamePath, (exists2) => {
          if (!exists2) {
            const runtime = [
              this.serverless.service.provider.name,
              this.serverless.service.provider.runtime,
            ].join('.');
            const testTemplateFile = [
              'test',
              runtime,
              this.serverless.service.custom['serverless-tdd-plugin'].testFramework
            ].join('-') + '.js';

            templateFilenamePath = path.join(__dirname, 'templates', testTemplateFile);
          }
          const templateString = utils.getTemplateFromFile(templateFilenamePath);

          const content = ejs.render(templateString, {
            functionName: funcName,
            functionPath: funcPath,
            handlerName: handler,
          });

          fse.writeFile(testFilePath, content, (err) => {
            if (err) {
              myModule.serverless.cli.log(`Creating file ${testFilePath} failed: ${err}`);
              return new Error(`Creating file ${testFilePath} failed: ${err}`);
            }
            return myModule.serverless.cli.log(`serverless-tdd-plugin: created ${testFilePath}`);
          });
        });
        return null;
      });
    });
  }

  // Helper functions

  getFunctions(funcList) {
    const myModule = this;

    return new BbPromise((resolve) => {
      const funcObjs = {};
      const allFuncs = myModule.serverless.service.functions;

      if (funcList.length === 0) {
        return resolve(allFuncs);
      }

      let func;
      funcList.forEach((funcName) => {
        func = allFuncs[funcName];
        if (func) {
          funcObjs[funcName] = func;
        } else {
          myModule.serverless.cli.log(`Warning: Could not find function '${funcName}'.`);
        }
      });
      resolve(funcObjs);

      return null;
    });
  }

  createAWSNodeJSFuncFile(handlerPath, runtime) {
    // read template and render
    let templateFile = utils.getDefaultFunctionTemplate(runtime);
    
    if (this.serverless.service.custom &&
      this.serverless.service.custom['serverless-tdd-plugin'] &&
      this.serverless.service.custom['serverless-tdd-plugin'].functionTemplate) {
      templateFile = path.join(this.serverless.config.servicePath,
        this.serverless.service.custom['serverless-tdd-plugin'].functionTemplate);
    }
    const suffix = path.extname(templateFile).replace('ejs', 'js').replace('.', '');
    const templateText = fse.readFileSync(templateFile).toString();

    // Define output file
    const handlerInfo = path.parse(handlerPath);
    const handlerDir = path.join(this.serverless.config.servicePath, handlerInfo.dir);
    const handlerFile = `${handlerInfo.name}.${suffix}`;
    const handlerFunction = handlerInfo.ext.replace(/^\./, '');
    const filePath = path.join(handlerDir, handlerFile);

    const outFile = ejs.render(templateText, {
      handlerFunction,
    });
    this.serverless.utils.writeFileDir(filePath);
    if (this.serverless.utils.fileExistsSync(filePath)) {
      const errorMessage = [
        `File "${filePath}" already exists. Cannot create function.`,
      ].join('');
      throw new this.serverless.classes.Error(errorMessage);
    }
    fse.writeFileSync(path.join(handlerDir, handlerFile), outFile);

    this.serverless.cli.log(`Created function file "${path.join(handlerDir, handlerFile)}"`);
    return BbPromise.resolve();
  }
  
  initRunner(config) {
    if (! config.testFramework ) {
       throw(new Error(`Parameter testFramework not set`)); 
    }
    const TestRunner = require(`./${config.testFramework}-runner`);  
    this.testRunner = new TestRunner();
    return this.testRunner;
  }

  getWrapper(modName, modPath, handler) {
    let wrapped;
    // TODO: make this fetch the data from serverless.yml
  
    if (process.env.SERVERLESS_MOCHA_PLUGIN_LIVE) {
      const mod = initLiveModule(modName);
      wrapped = lambdaWrapper.wrap(mod);
    } else {
      /* eslint-disable global-require */
      const mod = require(process.env.SERVERLESS_TEST_ROOT + modPath);
      /* eslint-enable global-require */
      wrapped = lambdaWrapper.wrap(mod, {
        handler,
      });
    }
    return wrapped;
  };

  createFunction() {
    this.serverless.cli.log('Generating function...');
    const functionName = this.options.function;
    const handler = this.options.handler;

    const serverlessYmlFilePath = path
      .join(this.serverless.config.servicePath, 'serverless.yml');

    const serverlessYmlFileContent = fse
      .readFileSync(serverlessYmlFilePath).toString();

    return this.serverless.yamlParser.parse(serverlessYmlFilePath)
      .then((config) => {
        const runtime = utils.getProvider(config);
        const functionTemplate = utils.getDefaultFunctionTemplate(runtime);

        if (! fse.existsSync(functionTemplate)) {
          const errorMessage = [
            `Provider / Runtime "${runtime}" is not supported.`,
            ` Supported runtimes are: ${humanReadableFunctionRuntimes}.`,
          ].join('');
          throw new this.serverless.classes.Error(errorMessage);
        }

        const ymlEditor = yamlEdit(serverlessYmlFileContent);

        if (ymlEditor.hasKey(`functions.${functionName}`)) {
          const errorMessage = [
            `Function "${functionName}" already exists. Cannot create function.`,
          ].join('');
          throw new this.serverless.classes.Error(errorMessage);
        }

        const funcDoc = {};
        const funcData = { handler };
        if (this.options.httpEvent) {
          let events = [];
          if (typeof this.options.httpEvent === 'string') {
            events = [
              this.options.httpEvent,
            ];
          } else {
            events = this.options.httpEvent;
          }
          funcData.events = [];

          events.forEach((val) => {
            this.serverless.cli.log(`Add http event '${val}'`);

            funcData.events.push({
              http: val,
            });
          });
        }
        funcDoc[functionName] = this.serverless.service.functions[functionName] = funcData;

        if (ymlEditor.insertChild('functions', funcDoc)) {
          const errorMessage = [
            `Could not find functions in ${serverlessYmlFilePath}`,
          ].join('');
          throw new this.serverless.classes.Error(errorMessage);
        }

        fse.writeFileSync(serverlessYmlFilePath, ymlEditor.dump());
        return this.createAWSNodeJSFuncFile(handler, runtime);

        throw new this.serverless.classes.Error(`Unknown runtime ${runtime}`);

//        return BbPromise.resolve();
      });
  }
}

module.exports = mochaPlugin;
module.exports.lambdaWrapper = lambdaWrapper;

const initLiveModule = module.exports.initLiveModule = (modName) => {
  const functionName = [
    process.env.SERVERLESS_MOCHA_PLUGIN_SERVICE,
    process.env.SERVERLESS_MOCHA_PLUGIN_STAGE,
    modName,
  ].join('-');

  return {
    region: process.env.SERVERLESS_MOCHA_PLUGIN_REGION,
    lambdaFunction: functionName,
  };
};

