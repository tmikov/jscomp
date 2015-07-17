// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/** This is used only internally by the generated code in object expressions with accessors */
function _defineAccessor (obj, prop, getter, setter)
{
    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)],
            ["get", getter], ["set", setter]
        ],[],
        "%[obj].raw.oval->defineOwnProperty(%[%frame], %[prop].raw.sval,"+
        "js::PROP_CONFIGURABLE |"+
        "js::PROP_ENUMERABLE |"+
        "js::PROP_GET_SET"+
        ", JS_UNDEFINED_VALUE"+
        ", %[get].tag == js::VT_FUNCTION ? %[get].raw.fval : NULL"+
        ", %[set].tag == js::VT_FUNCTION ? %[set].raw.fval : NULL"+
        ");"
    );
}

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

function hidden (obj, prop, func)
{
    defineProperty(obj, prop, {writable: true, configurable: true, value: func});
}

hidden(Object, "defineProperty", defineProperty);

hidden(Object, "defineProperties", defineProperties);

hidden(Object, "create", function object_create (proto, properties)
{
    var obj = __asm__({},["result"],[["proto",proto]],[],
        "%[result] = js::makeObjectValue(js::objectCreate(%[%frame], %[proto]));"
    );
    if (properties !== void 0)
        defineProperties(obj, properties);
    return obj;
});

hidden(Object.prototype, "toString", function object_toString()
{
    if (this === void 0)
        return "[object Undefined]";
    if (this === null)
        return "[object Null]";
    //FIXME: handle other classes
    return "[object Object]";
});

hidden(Object.prototype, "toLocaleString", function object_toLocaleString()
{
    return this.toString();
});

hidden(Function.prototype, "call", function function_call (thisArg)
{
    return __asm__({},["result"],[["thisArg", thisArg]],[],
        '%[result] = %[%argc] > 1' +
            '? js::call(%[%frame], %[%argv][0], %[%argc]-1, %[%argv]+1)' +
            ': js::call(%[%frame], %[%argv][0], 1, &%[thisArg]);'
    );
});


// Error
//
hidden(Error.prototype, "name", "Error");
hidden(Error.prototype, "message", "");
hidden(Error.prototype, "toString", function error_toString ()
{
    var name = this.name;
    name = name !== void 0 ? String(name) : "";
    var msg = this.message;
    msg = msg !== void 0 ? String(msg) : "";

    if (!name)
        return msg;
    if (!msg)
        return name;
    return name + ": " + msg;
});

// TypeError
//
hidden(TypeError.prototype, "name", "TypeError");

// SyntaxError
//
// NOTE: Error and TypeError are system-declared but the rest of the errors aren't
SyntaxError.prototype = Object.create(Error.prototype);
hidden(SyntaxError.prototype, "name", "SyntaxError");

// Array
//
hidden(Array, "isArray", function array_isArray (arg)
{
    return __asm__({},["result"],[["arg", arg]],[],
        "%[result] = js::makeBooleanValue(js::isValueTagObject(%[arg].tag) && dynamic_cast<js::Array*>(%[arg].raw.oval));"
    );
});

hidden(Array.prototype, "push", function array_push(dummy)
{
    // TODO: special case arguments.length < 2 (also arguments.length shouldn't create the object)
    var n = this.length | 0;
    var e = arguments.length;
    this.length = n + e;
    for ( var i = 0; i < e; ++i )
        this[n++] = arguments[i];
});

function copyArray (dest, destIndex, src, srcLen)
{
    for ( var i = 0; i < srcLen; ++i, ++destIndex )
        if (i in src)
            dest[destIndex] = src[i];
}

hidden(Array.prototype, "concat", function array_concat()
{
    var O = Object(this);
    var n;

    // Size the result array first
    n = Array.isArray(O) ? Number(O.length) : 1;
    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        var elem = arguments[i];
        n += Array.isArray(elem) ? Number(elem.length) : 1;
    }

    var A = [];
    A.length = n;

    n = 0;
    // Copy O
    if (Array.isArray(O)) {
        var len = Number(O.length);
        copyArray(A, n, O, len);
        n += len;
    } else {
        A[n++] = O;
    }

    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        var elem = arguments[i];
        if (Array.isArray(elem)) {
            var len = Number(elem.length);
            copyArray(A, n, elem, len);
            n += len;
        } else {
            A[n++] = elem;
        }
    }

    return A;
});

hidden(Array.prototype, "slice", function array_slice(start, end)
{
    var O = Object(this);
    var A = [];
    var len = O.length >>> 0; // toUint32()
    var k, final;

    if ((k = Number(start)) < 0) {
        if ((k += len) < 0)
            k = 0;
    } else {
        if (k > len)
            k = len;
    }

    if (end !== void 0) {
        if ((final = Number(end)) < 0) {
            if ((final += len) < 0)
                final = 0;
        } else {
            if (final > len)
                final = len;
        }
    } else {
        final = len;
    }

    k >>>= 0; // toUint32
    final >>>= 0; // toUint32

    A.length = final - k;
    for ( var n = 0; k < final; ++k, ++n )
        if (k in O)
            A[n] = O[k];

    return A;
});
