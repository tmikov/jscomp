// Median-of-3 killer
var N = 5000;
var a = new Array(N);

for ( var i = 0; i < N; ++i )
    a[i] = i;

var keys = {};
var candidate = 0;
var count = 0;

a.sort(function cmp(x,y) {
    if (!(x in keys) && !(y in keys)) {
        if (x === candidate)
            keys[x] = count++;
        else
            keys[y] = count++;
    }

    if (!(x in keys)) {
        candidate = x;
        return 1;
    }
    if (!(y in keys)) {
        candidate = y;
        return -1;
    }

    return keys[x] < keys[y] ? -1 : +1;
});

var bad = new Array(N);
for ( var i = 0; i < N; ++i )
    bad[a[i]] = i;

console.log(bad);
//for ( var i = 0; i < N; ++i )
//    console.log(bad[i]);
