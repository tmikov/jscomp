var assert = require("assert");

assert.equal(Math.max(), -Infinity);
assert.equal(Math.max(1,2), 2);
assert.equal(Math.max(1,3,2), 3);
assert(isNaN(Math.max(1,NaN,2)));
assert.equal(Math.max(-0,+0), +0);

assert.equal(Math.min(), Infinity);
assert.equal(Math.min(1,2), 1);
assert.equal(Math.min(1,3,2), 1);
assert(isNaN(Math.min(1,NaN,2)));
assert.equal(Math.min(-0,+0), -0);

assert.equal(Math.ceil(1),1);
assert.equal(Math.ceil(1.1),2);
assert(isNaN(Math.ceil(NaN)));
assert.equal(Math.ceil(+0),+0);
assert.equal(Math.ceil(-0),-0);
assert.equal(Math.ceil(+Infinity),+Infinity);
assert.equal(Math.ceil(-Infinity),-Infinity);
assert.equal(Math.ceil(-0.5),-0);

assert.equal(Math.floor(1),1);
assert.equal(Math.floor(1.1),1);
assert(isNaN(Math.floor(NaN)));
assert.equal(Math.floor(+0),+0);
assert.equal(Math.floor(-0),-0);
assert.equal(Math.floor(+Infinity),+Infinity);
assert.equal(Math.floor(-Infinity),-Infinity);
assert.equal(Math.floor(0.5),0);

assert(isNaN(Math.abs("aa")));
assert(isNaN(Math.abs(NaN)));
assert.equal(Math.abs(-0),0);
assert.equal(Math.abs(-Infinity), Infinity);
assert.equal(Math.abs(-1),1);
assert.equal(Math.abs(1),1);

assert.equal(Math.pow(2,3), 8);
assert.equal(Math.pow("aa",0), 1);
assert.equal(Math.pow(NaN,0), 1);
