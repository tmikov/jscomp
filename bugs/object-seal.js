"use strict";

var assert=require("assert");

function mustThrow (cb)
{
    try {
        cb();
    } catch (e) {
        return;
    }
    assert(false, "didn't throw");
}

var x = {a: 10};
Object.preventExtensions(x);
++x.a;
mustThrow(function(){ x.b = 20; });
delete x.a;

var x = {a: 10};
Object.seal(x);
++x.a;
mustThrow(function(){ x.b = 20; });
mustThrow(function(){ delete x.a; });

var x = {a: 10};
Object.freeze(x);
mustThrow(function(){ ++x.a; });
mustThrow(function(){ x.b = 20; });
mustThrow(function(){ delete x.a; });

var x = [1,2];
Object.preventExtensions(x);
++x[0];
mustThrow(function(){ x[3] = 20; });
delete x[1];

var x = [1,2];
Object.seal(x);
++x[0];
mustThrow(function(){ x[3] = 20; });
mustThrow(function(){ delete x[1]; });

var x = [1,2];
Object.freeze(x);
mustThrow(function(){ ++x[0]; });
mustThrow(function(){ x[3] = 20; });
mustThrow(function(){ delete x[1]; });
