"use strict";

function targetfunc (a,b)
{
    console.log(this, a, b);
}

targetfunc(2,3);

targetfunc.bind()(10,20,30);
targetfunc.bind(11)(21,31);
targetfunc.bind(12,22)(32);

function Cons (a,b)
{
    console.log("Cons this=", this);
    this.a = a;
    this.b = b;
}

Cons.prototype.base = "base";

var v = new Cons(1,2);
console.log(v, v.base)
var bound = Cons.bind("this",10);
var v = new bound(20);
console.log(v, v.base);

Cons.prototype = { base: "new base" };

var v = new Cons(1,2);
console.log(v, v.base)
var v = new bound(20);
console.log(v, v.base);

bound.prototype = {}
