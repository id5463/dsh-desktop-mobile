#!/usr/bin/env node
'use strict'
require('./index.js').run(process.argv.slice(2)).then((code) => process.exit(code))
