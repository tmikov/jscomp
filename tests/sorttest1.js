var assert = require("assert");
var N = 200000;
var a = new Array(N);

for ( var i = 0; i < N; ++i )
    a[i] = String(Math.random());

a.sort();

for ( var i = 1; i < N; ++i )
    assert(a[i] >= a[i-1]);
