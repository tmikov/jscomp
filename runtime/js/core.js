// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function defineProperty (obj, prop, descriptor)
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
}

function defineProperties (obj, props)
{
    if (obj === null || typeof obj !== "object" && typeof obj !== "function")
        throw new TypeError("defineProperties() with a non-object");

    for ( var pn in Object(props) )
        defineProperty(obj, pn, props[pn]);

    return obj;
}

function method (obj, prop, func)
{
    defineProperty(obj, prop, {writable: true, configurable: true, value: func});
}

method(Object, "defineProperty", defineProperty);

method(Object, "defineProperties", defineProperties);

method(Object, "create", function object_create (proto, properties)
{
    var obj = __asm__({},["result"],[["proto",proto]],[],
        "%[result] = js::makeObjectValue(js::objectCreate(%[%frame], %[proto]));"
    );
    if (properties !== void 0)
        defineProperties(obj, properties);
    return obj;
});

method(Object.prototype, "toString", function object_toString()
{
    if (this === void 0)
        return "[object Undefined]";
    if (this === null)
        return "[object Null]";
    //FIXME: handle other classes
    return "[object Object]";
});

method(Object.prototype, "toLocaleString", function object_toLocaleString()
{
    return this.toString();
});

method(Function.prototype, "call", function function_call (thisArg)
{
    return __asm__({},["result"],[["thisArg", thisArg]],[],
        '%[result] = %[%argc] > 1' +
            '? js::call(%[%frame], %[%argv][0], %[%argc]-1, %[%argv]+1)' +
            ': js::call(%[%frame], %[%argv][0], 1, &%[thisArg]);'
    );
});



/** Temporary method to simply typing. We delete it in the end */
method(Error.prototype, "toString", function error_toString ()
{
    return "Error: "+ this.message;
});

TypeError.prototype = Object.create(Error.prototype);
SyntaxError.prototype = Object.create(Error.prototype);

method(Array.prototype, "push", function array_push(dummy)
{
    // TODO: special case arguments.length < 2 (also arguments.length shouldn't create the object)
    var n = this.length | 0;
    var e = arguments.length;
    this.length = n + e;
    for ( var i = 0; i < e; ++i )
        this[n++] = arguments[i];
});
