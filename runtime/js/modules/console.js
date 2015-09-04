// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function pr (x)
{
    __asmh__({},"#include <stdio.h>");
    __asm__({},[],[["x", x]],[],
        '%[x] = js::toString(%[%frame], %[x]);\n'+
        'printf("%s", %[x].raw.sval->getStr());'
    );
}

function printVal (val)
{
    if (val instanceof Array) {
        pr("[ ");
        for ( var i = 0, e = val.length; i < e; ++i ) {
            if (i > 0)
                pr(", ");
            if (i in val)
                printVal(val[i]);
        }
        pr(" ]");
    } else if (typeof val === "object" && val !== null) {
        pr("{ ");
        var first = true;
        for ( var prop in val ) {
            if (!first)
                pr(", ");
            first = false;
            pr(prop);
            pr(": ");
            printVal(val[prop]);
        }
        pr(" }");
    } else if (typeof val === "function") {
        pr("[Function");
        if (val.name) {
            pr(" ");
            pr(val.name);
        }
        pr("]");
    } else
        pr(val);
}

function print() {

    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        if (i > 0)
            pr(" ");
        printVal(arguments[i]);
    }
    pr("\n");
}

exports.log = print;
exports.error = print;
exports.warn = print;
