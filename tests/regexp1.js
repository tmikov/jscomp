var r = new RegExp("(a)","g");
console.log(r.toString());

var m;
while (m = r.exec("baaa")) {
    var t = "[";
    for ( var i in m ) {
        t += i;
        t += "=";
        t += m[i];
        t += " ";
    }
    t += "]";
    console.log(t, r.lastIndex);
}
