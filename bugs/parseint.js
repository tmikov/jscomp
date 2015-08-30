var assert = require("assert");

assert.equal(parseInt("100"),100);
assert.equal(parseInt("0x10"),16);
assert(isNaN(parseInt("")));
assert.equal(parseInt("10a"),10);
assert.equal(parseInt("12345678901234567890"),12345678901234567000);
assert.equal(parseInt("1234567890123456789012345"), 1.2345678901234568e+24);
