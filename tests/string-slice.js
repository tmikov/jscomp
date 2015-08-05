function pr(x)
{
    console.log(x, x.slice(), x.slice(0,3), x.slice(0,100), x.slice(0,Infinity));
    console.log("empty=",x.slice(0,0))
    console.log(x.slice(0,1), x.slice(-1), x.slice(1,2), x.slice(1,3))
    console.log();
}

var x = "012";
pr(x);

x = "a𤭢b";
pr(x);

x = "a€b";
pr(x);
