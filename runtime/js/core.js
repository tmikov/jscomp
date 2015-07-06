function print() {
    __asmh__({},"#include <stdio.h>");

    function pr (x)
    {
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
                var elem = val[i];
                if (elem !== void 0)
                    printVal(elem);
            }
            pr(" ]");
        } else
            pr(val);
    }

    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        if (i > 0)
            pr(" ");
        printVal(arguments[i]);
    }
    pr("\n");
}

var console = { log: print };

Function.prototype.call = function call (thisArg)
{
    return __asm__({},["result"],[["thisArg", thisArg]],[],
        '%[result] = %[%argc] > 1' +
            '? js::call(%[%frame], %[%argv][0], %[%argc]-1, %[%argv]+1)' +
            ': js::call(%[%frame], %[%argv][0], 1, &%[thisArg]);'
    );
};

Object.create = function Object_create (proto)
{
    return __asm__({},["result"],[["proto",proto]],[],
        "%[result] = js::makeObjectValue(js::objectCreate(%[%frame], %[proto]));"
    );
};

function Error (message)
{
    this.message = message;
}

Error.prototype.toString = function error_toString ()
{
    return "Error: "+ this.message;
};

Array.prototype.push = function array_push(dummy)
{
    // TODO: special case arguments.length < 2 (also arguments.length shouldn't create the object)
    var n = this.length | 0;
    var e = arguments.length;
    this.length = n + e;
    for ( var i = 0; i < e; ++i )
        this[n++] = arguments[i];
};
