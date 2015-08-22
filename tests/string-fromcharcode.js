var assert = require("assert");

assert.equal(String.fromCharCode(), "");
assert.equal(String.fromCharCode(97), "a");
assert.equal(String.fromCharCode(97,98), "ab");
assert.equal(String.fromCharCode(
    97+0,97+1,97+2,97+3,97+4,97+5,97+6,97+7,97+8,97+9,
    97+10,97+11,97+12,97+13,97+14,97+15,97+16,97+17),
    "abcdefghijklmnopqr"
);

assert.equal(String.fromCharCode(0xD800),String.fromCharCode(0xFFFD));
assert.equal(String.fromCharCode(0xD800),"\uFFFD");
assert.equal(String.fromCharCode(0xDC00),"\uFFFD");
assert.equal(String.fromCharCode(0xD800,97),"\uFFFDa");
