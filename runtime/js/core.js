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
                if (i in val)
                    printVal(val[i]);
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

console.log = print;

Object.defineProperty = function Object_defineProperty (obj, prop, descriptor)
{
    if (obj === null || typeof obj !== "object" && typeof obj !== "function")
        throw new TypeError("defineProperty() with a non-object");

    if (descriptor === void 0)
        descriptor = {};

    if (("get" in descriptor) && typeof descriptor.get !== "function")
        throw new TypeError("'get' is not a function");
    if (("set" in descriptor) && typeof descriptor.set !== "function")
        throw new TypeError("'set' is not a function");

    var getset = false;
    if (descriptor.get || descriptor.set) {
        getset = true;
        if (("value" in descriptor) || ("writable" in descriptor))
            throw new TypeError("Cannot specify 'value' or 'writable' with get/set");
    }

    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)], ["value", descriptor.value],
            ["configurable", !!descriptor.configurable], ["enumerable", !!descriptor.enumerable],
            ["writable", !!descriptor.writable], ["getset", getset], ["get", descriptor.get], ["set", descriptor.set]
        ],[],
        "%[obj].raw.oval->defineOwnProperty(%[%frame], %[prop].raw.sval,"+
          "(%[configurable].raw.bval ? js::PROP_CONFIGURABLE : 0) |"+
          "(%[enumerable].raw.bval ? js::PROP_ENUMERABLE : 0) |"+
          "(%[writable].raw.bval ? js::PROP_WRITEABLE : 0) |"+
          "(%[getset].raw.bval ? js::PROP_GET_SET : 0)"+
        ", %[value]"+
        ", %[get].tag == js::VT_FUNCTION ? %[get].raw.fval : NULL"+
        ", %[set].tag == js::VT_FUNCTION ? %[set].raw.fval : NULL"+
        ");"
    );

    return obj;
};

Object._method = function (obj, prop, func)
{
    Object.defineProperty(obj, prop, {writable: true, configurable: true, value: func});
};

Object._method(Object, "defineProperty", Object.defineProperty);

Object._method(Object, "defineProperties", function Object_defineProperties (obj, props)
{
    if (obj === null || typeof obj !== "object" && typeof obj !== "function")
        throw new TypeError("defineProperties() with a non-object");

    for ( var pn in Object(props) )
        Object.defineProperty(obj, pn, props[pn]);

    return obj;
});

Object._method(Object, "create", function Object_create (proto, properties)
{
    var obj = __asm__({},["result"],[["proto",proto]],[],
        "%[result] = js::makeObjectValue(js::objectCreate(%[%frame], %[proto]));"
    );
    if (properties !== void 0)
        Object.defineProperties(obj, properties);
    return obj;
});

Object._method(Function.prototype, "call", function function_call (thisArg)
{
    return __asm__({},["result"],[["thisArg", thisArg]],[],
        '%[result] = %[%argc] > 1' +
            '? js::call(%[%frame], %[%argv][0], %[%argc]-1, %[%argv]+1)' +
            ': js::call(%[%frame], %[%argv][0], 1, &%[thisArg]);'
    );
});


function Error (message)
{
    this.message = message;
}

/** Temporary method to simply typing. We delete it in the end */
Object._method(Error.prototype, "toString", function error_toString ()
{
    return "Error: "+ this.message;
});

function TypeError (message)
{
    Error.call(this, message);
}

TypeError.prototype = Object.create(Error.prototype);

Object._method(Array.prototype, "push", function array_push(dummy)
{
    // TODO: special case arguments.length < 2 (also arguments.length shouldn't create the object)
    var n = this.length | 0;
    var e = arguments.length;
    this.length = n + e;
    for ( var i = 0; i < e; ++i )
        this[n++] = arguments[i];
});

// Remove the temporary helper
delete Object._method;
