// This tests really pushes the GC as every number has to be converted to string
var N = 1000;
var a = new Array(N);

for ( var i = 0; i < N; ++i )
    a[i] = Math.random();

a.sort();
