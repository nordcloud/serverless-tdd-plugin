'use strict';

const expect = require('chai').expect;
const path = require('path');
const fse = require('fs-extra');
const TestRunner = require('../mocha-runner');

describe('mochaRunner', () => {
  it('mochaRunner provides chai with getChai', () => {
    const testRunner = new TestRunner();
    const chai = testRunner.getChai();
    expect(typeof(chai)).to.eql('object');
  });
});
