var N = 200000;
var a = new Array(N);

for ( var i = 0; i < N; ++i )
    a[i] = Math.random();

a.sort(function (a, b) {
    return a < b ? -1 : +1;
});
