function print() {
    __asmh__({},"#include <stdio.h>");
    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        if (i > 0)
            __asm__({},[],[],[],"putchar(' ');");
        __asm__({},[],[["x", arguments[i]]],[],
                '%[x] = js::toString(%[%frame], %[x]);\n'+
                'printf("%s", %[x].raw.sval->getStr());'
        );
    }
    __asm__({},[],[],[],"putchar('\\n');");
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
