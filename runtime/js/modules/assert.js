// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function AssertionError(options) {
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator;
    this.message = options.message || (this.actual + " " + this.operator + " " + this.expected);
}

AssertionError.prototype = Object.create(Error.prototype);

function fail(actual, expected, message, operator) {
    throw new assert.AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: operator,
    });
}

function ok(value, message) {
    if (!!!value) fail(value, true, message, '==', assert.ok);
}

function equal(actual, expected, message) {
    if (actual != expected) fail(actual, expected, message, '==');
}

function notEqual(actual, expected, message) {
    if (actual == expected) {
        fail(actual, expected, message, '!=', assert.notEqual);
    }
}

var assert = module.exports = ok;
assert.AssertionError = AssertionError;
assert.fail = fail;
assert.ok = ok;
assert.equal = equal;
assert.notEqual = notEqual;
