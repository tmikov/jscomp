function pr(x)
{
    console.log("x (", x.length, ") is", x);
    console.log(x[0],x[1],x[2],x[3]);
    console.log(x.charCodeAt(0),x.charCodeAt(1),x.charCodeAt(2),x.charCodeAt(3));
    for ( var i = 0; i < x.length; ++i )
        console.log(x[i], x.charCodeAt(i));
    console.log();
}

var x = "123";
pr(x);

x = "a𤭢b";
pr(x);

x = "a€b";
pr(x);
