// Regular quicksort killer
var N = 10000;
var a = new Array(N);

for ( var i = 0; i < N; ++i )
    a[i] = i;

a.sort(function cmp(a,b) {
    return a < b ? -1 : +1;
});
