"use strict";
var assert = require("assert");

function assertThrow (f)
{
    try {
        f();
    } catch (e) {
        return;
    }
    assert(false, "did not throw");
}

var x = {}

Object.defineProperty(x, "a", {value: 1, writable: true, enumerable: true});
assertThrow(function(){Object.defineProperty(x, "a", {value: 1, writable: true, enumerable: false});});
Object.defineProperty(x, "a", {value: 2, writable: false, enumerable: true});
assertThrow(function(){Object.defineProperty(x, "a", {value: 3, writable: false, enumerable: true});});

var x = {}
Object.defineProperty(x, "a", {value: 1, writable: true, enumerable: true});
Object.seal(x);
Object.defineProperty(x, "a", {value: 2, writable: true, enumerable: true});
Object.defineProperty(x, "a", {value: 2, writable: false, enumerable: true});
Object.defineProperty(x, "a", {value: 2, writable: false, enumerable: true});
Object.defineProperty(x, "a", {writable: false, enumerable: true});
assertThrow(function(){Object.defineProperty(x, "a", {value: 3, writable: false, enumerable: true});});
assertThrow(function(){Object.defineProperty(x, "a", {value: 2, writable: false, enumerable: false});});
assertThrow(function(){x.b = 2;});
assertThrow(function(){Object.defineProperty(x, "b", {value: 2, writable: true, enumerable: true});});

var x = {};
Object.defineProperty(x, "a", {value: 1, writable: true, enumerable: true});
Object.freeze(x);
assertThrow(function(){Object.defineProperty(x, "a", {value: 1, writable: true, enumerable: true});});
assertThrow(function(){Object.defineProperty(x, "a", {value: 2, writable: true, enumerable: true});});
