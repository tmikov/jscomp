var assert = require("assert")

assert.equal(encodeURI("ab"),"ab");
assert.equal(encodeURI("a%b"),"a%25b");
assert.equal(encodeURI("a𤭢b"),"a%F0%A4%AD%A2b");
assert.equal(encodeURI("a€b"),"a%E2%82%ACb");
assert.equal(encodeURIComponent("a/b"),"a%2Fb");

assert.equal(decodeURI("ab"),"ab");
assert.equal(decodeURI("a%25b"),"a%b");
assert.equal(decodeURI("a%F0%A4%AD%A2b"),"a𤭢b");
assert.equal(decodeURI("a%E2%82%ACb"),"a€b");
assert.equal(decodeURIComponent("a%2Fb"),"a/b");
