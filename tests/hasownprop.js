var assert = require("assert");

var x = { a: 10 };
x[1] = 1;
assert(x.hasOwnProperty("a"));
assert(!x.hasOwnProperty("aa"));
assert(x.hasOwnProperty(1));
assert(!x.hasOwnProperty(0));

var y = [1,2];

assert(y.hasOwnProperty("length"));
assert(!y.hasOwnProperty("aa"));
assert(y.hasOwnProperty(0));
assert(y.hasOwnProperty(1));
assert(!y.hasOwnProperty(2));
