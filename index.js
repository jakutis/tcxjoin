#!/usr/bin/env node

var lib = require('./lib');

if (require.main === module) {
  lib({
    mode: process.argv[2],
    a: process.argv[3],
    b: process.argv[4],
    output: process.argv[5],
  });
} else {
  module.exports = lib;
}
