// Test an object instead of an array
var N = 1000;
var a = {};
a.length = N;

for ( var i = 0; i < N; ++i )
    a[i] = String(Math.random());

Array.prototype.sort.call(a);
