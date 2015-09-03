var assert=require("assert");

assert.equal("123".indexOf("2"), 1);
assert.equal("123".indexOf("3"), 2);
assert.equal("123".indexOf("0"), -1);
assert.equal("123".indexOf("2", 2), -1);
assert.equal("123".indexOf(""), 0);
assert.equal("".indexOf(""), 0);
assert.equal("1231".indexOf("1"), 0);
assert.equal("1231".indexOf("1", 1), 3);
assert.equal("1231".indexOf("\u0000"), -1);
assert.equal("12\u000031".indexOf("\u0000"), 2);
