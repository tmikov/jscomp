// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/** This is used only internally by the generated code in object expressions with accessors */
function _defineAccessor (obj, prop, getter, setter)
{
    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)],
            ["get", getter], ["set", setter]
        ],[["accessor"]],
        "%[accessor] = js::makePropertyAccessorValue(new(%[%frame]) js::PropertyAccessor("+
            "%[get].tag == js::VT_FUNCTION ? %[get].raw.fval : NULL,"+
            "%[set].tag == js::VT_FUNCTION ? %[set].raw.fval : NULL"+
        "));\n"+
        "%[obj].raw.oval->defineOwnProperty(%[%frame], %[prop].raw.sval,"+
        "js::PROP_CONFIGURABLE |"+
        "js::PROP_ENUMERABLE |"+
        "js::PROP_GET_SET"+
        ", %[accessor]"+
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

    var value;
    var getset = false;
    if (descriptor.get || descriptor.set) {
        if (("value" in descriptor) || ("writable" in descriptor))
            throw new TypeError("Cannot specify 'value' or 'writable' with get/set");

        getset = true;
        __asm__({},[],[["get", descriptor.get], ["set", descriptor.set], ["value", value]],[],
            "%[value] = js::makePropertyAccessorValue(new(%[%frame]) js::PropertyAccessor("+
            "%[get].tag == js::VT_FUNCTION ? %[get].raw.fval : NULL,"+
            "%[set].tag == js::VT_FUNCTION ? %[set].raw.fval : NULL"+
            "));"
        );
    } else {
        value = descriptor.value;
    }

    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)], ["value", value],
            ["configurable", !!descriptor.configurable], ["enumerable", !!descriptor.enumerable],
            ["writable", !!descriptor.writable], ["getset", getset]
        ],[],
        "%[obj].raw.oval->defineOwnProperty(%[%frame], %[prop].raw.sval,"+
          "(%[configurable].raw.bval ? js::PROP_CONFIGURABLE : 0) |"+
          "(%[enumerable].raw.bval ? js::PROP_ENUMERABLE : 0) |"+
          "(%[writable].raw.bval ? js::PROP_WRITEABLE : 0) |"+
          "(%[getset].raw.bval ? js::PROP_GET_SET : 0)"+
        ", %[value]"+
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

// Function
//
hidden(Function.prototype, "call", function function_call (thisArg)
{
    return __asm__({},["result"],[["thisArg", thisArg]],[],
        '%[result] = %[%argc] > 1' +
            '? js::call(%[%frame], %[%argv][0], %[%argc]-1, %[%argv]+1)' +
            ': js::call(%[%frame], %[%argv][0], 1, &%[thisArg]);'
    );
});

/* MDN bind() polyfill preserved here for posterity
hidden(Function.prototype, "bind", function function_bind (oThis)
{
    if (typeof this !== 'function')
        throw new TypeError("Function.prototype.bind - this is not a function");

    var aArgs = Array.prototype.slice.call(arguments, 1),
        fToBind = this,
        fNOP = function() {},
        fBound = function() {
            return fToBind.apply(this instanceof fNOP
                   ? this
                   : oThis,
                   aArgs.concat(Array.prototype.slice.call(arguments)));
        };

    fNOP.prototype = this.prototype;
    fBound.prototype = new fNOP();

    return fBound;
});
*/


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
function isArrayBase (arg)
{
    return __asm__({},["result"],[["arg", arg]],[],
        "%[result] = js::makeBooleanValue(js::isValueTagObject(%[arg].tag) && dynamic_cast<js::ArrayBase*>(%[arg].raw.oval));"
    );
}
function isArrayBaseOfLength (arg, length)
{
    return __asm__({},["result"],[["arg", arg], ["length", Number(length)]],[],
        "js::ArrayBase * ab;\n"+
        "%[result] = js::makeBooleanValue("+
            "js::isValueTagObject(%[arg].tag) && (ab = dynamic_cast<js::ArrayBase*>(%[arg].raw.oval)) != NULL && "+
            "ab->getLength() >= %[length].raw.nval"+
        ");"
    );
}
function isArray (arg)
{
    return __asm__({},["result"],[["arg", arg]],[],
        "%[result] = js::makeBooleanValue(js::isValueTagObject(%[arg].tag) && dynamic_cast<js::Array*>(%[arg].raw.oval));"
    );
}

hidden(Array, "isArray", isArray);

hidden(Array.prototype, "push", function array_push(dummy)
{
    var O = Object(this);
    var n = O.length >>> 0;
    /*
        This is what the code does, but we want to avoid allocating the arguments object

        var argc = arguments.length >>> 0;
        O.length = n + argc; // Resize the array in advance
        for ( var i = 0; i < argc; ++i )
            O[n++] = arguments[i];
     */
    var argc = __asm__({},["result"],[],[],"%[result] = js::makeNumberValue(%[%argc]);");
    O.length = n + argc - 1;
    for ( var i = 1; i < argc; ++i )
        O[n++] = __asm__({},["result"],[["i",i]],[],"%[result] = %[%argv][(uint32_t)%[i].raw.nval]");
    return n;
});

hidden(Array.prototype, "pop", function array_pop()
{
    var O = Object(this);
    var len = O.length >>> 0;
    if (len !== 0) {
        --len;
        var element = O[len];
        delete O[len];
        O.length = len;
        return element;
    } else {
        O.length = 0;
        return void 0;
    }
});

/**
 *
 * @param dest - must be ArrayBase of sufficient length
 * @param destIndex - must be a number
 * @param src
 * @param srcFrom - must be a number
 * @param srcTo - must be a number
 */
function copyToArray (dest, destIndex, src, srcFrom, srcTo)
{
    if (isArrayBaseOfLength(src, srcTo)) {
        // Fast case - copying from array to array
        // We know that dest is an array of sufficient size, destIndex, srcFrom and srcTo are numbers.

        __asm__({},[],[["dest",dest], ["destIndex",destIndex], ["src",src], ["srcFrom",srcFrom], ["srcTo",srcTo]],[],
            "uint32_t srcFrom = (uint32_t)%[srcFrom].raw.nval;\n"+
            "uint32_t srcTo = (uint32_t)%[srcTo].raw.nval;\n"+
            "::memcpy("+
                "&((js::ArrayBase *)%[dest].raw.oval)->elems[(uint32_t)%[destIndex].raw.nval],"+
                "&((js::ArrayBase *)%[src].raw.oval)->elems[srcFrom],"+
                "sizeof(js::TaggedValue)*(srcTo - srcFrom)"+
            ");"
        );
    } else {
        for ( var i = srcFrom; i < srcTo; ++i, ++destIndex )
            if (i in src)
                dest[destIndex] = src[i];
    }
}

hidden(Array.prototype, "concat", function array_concat()
{
    var O = Object(this);
    var n;

    // Size the result array first
    n = isArray(O) ? Number(O.length) : 1;
    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        var elem = arguments[i];
        n += isArray(elem) ? Number(elem.length) : 1;
    }

    var A = [];
    A.length = n;

    n = 0;
    // Copy O
    if (isArray(O)) {
        var len = Number(O.length);
        copyToArray(A, n, O, 0, len);
        n += len;
    } else {
        A[n++] = O;
    }

    for ( var i = 0, e = arguments.length; i < e; ++i ) {
        var elem = arguments[i];
        if (isArray(elem)) {
            var len = Number(elem.length);
            copyToArray(A, n, elem, 0, len);
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
    copyToArray(A, 0, O, k, final);

    return A;
});
