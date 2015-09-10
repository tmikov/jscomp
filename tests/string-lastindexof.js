var assert=require("assert");

assert.equal("123".lastIndexOf("2"), 1);
assert.equal("123".lastIndexOf("3"), 2);
assert.equal("123".lastIndexOf("0"), -1);
assert.equal("123".lastIndexOf("2", 0), -1);
assert.equal("123".lastIndexOf(""), 3);
assert.equal("".lastIndexOf(""), 0);
assert.equal("1231".lastIndexOf("1"), 3);
assert.equal("1231".lastIndexOf("1", 1), 0);
assert.equal("1231".lastIndexOf("\u0000"), -1);
assert.equal("12\u000031".lastIndexOf("\u0000"), 2);
