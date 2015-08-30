var assert = require("assert");

var x = {a: 1, b: "bla"};
assert.equal(JSON.stringify(x), '{"a":1,"b":"bla"}' );
//console.log(JSON.stringify(x, null, 4));

var s1 = '{"a":1,"b":"bla",    "10": 20 }';
var y = JSON.parse(s1);
assert.equal(JSON.stringify(y), '{"a":1,"b":"bla","10":20}' );
