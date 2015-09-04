function dotests (cvt)
{
    var x, y;

    // delete at start
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,0,2);
    console.log("after", x, y);
    console.log();

    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,0,10);
    console.log("after", x, y);
    console.log();

    // delete at end
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,3,2);
    console.log("after", x, y);
    console.log();

    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,-2,2);
    console.log("after", x, y);
    console.log();

    // delete in the middle
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,2,2);
    console.log("after", x, y);
    console.log();

    // insert
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,2,0, 21, 22);
    console.log("after", x, y);
    console.log();

    // append
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,Infinity,0, 60,70);
    console.log("after", x, y);
    console.log();

    // replace
    x = cvt([10,20,30,40,50]);
    console.log("before", x);
    y = Array.prototype.splice.call(x,2,2, 21, 22);
    console.log("after", x, y);
    console.log();
}

dotests(function (x){ return x;});

dotests(function (x) {
    var res = {};
    x.forEach(function (v, k) { res[k] = v; });
    res.length = x.length;
    return res;
});
