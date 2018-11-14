'use strict';

const expect = require('chai').expect;
const path = require('path');
const fse = require('fs-extra');
const TestRunner = require('../jest-runner');

describe('jestRunner', () => {
  it('jestRunner is object', () => {
    const testRunner = new TestRunner();
    expect(typeof(testRunner)).to.eql('object');
  });
});
