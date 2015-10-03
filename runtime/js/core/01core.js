// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function createNative (propCount)
{
    return __asm__({},["result"],[["propCount",propCount >>> 0]],[],
        "%[result] = js::makeObjectValue(js::NativeObject::make(%[%frame], (unsigned)%[propCount].raw.nval));"
    );
}

var ICLS_MEMORY      =  0;
var ICLS_STRING_PRIM =  1;
var ICLS_UNDEFINED   =  2;
var ICLS_NULL        =  3;
var ICLS_OBJECT      =  4;
var ICLS_ARGUMENTS   =  5;
var ICLS_ARRAY       =  6;
var ICLS_FUNCTION    =  7;
var ICLS_BOOLEAN     =  8;
var ICLS_NUMBER      =  9;
var ICLS_STRING      = 10;
var ICLS_ERROR       = 11;
var ICLS_REGEXP      = 12;
var ICLS_DATE        = 13;
var ICLS_JSON        = 14;
var ICLS_MATH        = 15;
var ICLS_ArrayBuffer = 16;
var ICLS_DataView    = 17;
var ICLS_Int8Array   = 18;
var ICLS_Uint8Array  = 19;
var ICLS_Uint8ClampedArray  = 20;
var ICLS_Int16Array   = 21;
var ICLS_Uint16Array  = 22;
var ICLS_Int32Array   = 23;
var ICLS_Uint32Array  = 24;
var ICLS_Float32Array = 25;
var ICLS_Float64Array = 26;

function getInternalClass (obj)
{
    return __asm__({},["result"],[["obj",obj]],[],
        "%[result] = js::makeNumberValue(js::getInternalClass(%[obj]));"
    );
}

function setInternalClass (obj, value)
{
    __asm__({},[],[["this", obj], ["value", value|0]],[],
        "((js::NativeObject *)%[this].raw.oval)->setInternalClass((js::InternalClass)%[value].raw.nval);"
    );
}

function newInitTag ()
{
    return {};
}

function setInitTag (obj, tag)
{
    needObject(tag, "setInitTag");
    if (!__asm__({},["res"],[["obj", obj], ["tag", tag]],[],
            "if (js::NativeObject * no = js::isNativeObject(%[obj])) {\n" +
            "    no->setInitTag(%[tag].raw.oval);\n" +
            "    %[res] = js::makeBooleanValue(true);\n" +
            "} else {\n" +
            "    %[res] = js::makeBooleanValue(false);\n" +
            "}"
        ))
    {
        throw TypeError("setInitTag with an invalid target");
    }

}

function checkInitTag (obj, tag)
{
    return __asm__({},["res"],[["obj", obj], ["tag", tag]],[],
        "%[res] = js::makeBooleanValue(js::checkInitTag(%[obj], %[tag]));"
    );
}

/** This is used only internally by the generated code in object expressions with accessors */
function _defineAccessor (obj, prop, getter, setter)
{
    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)],
            ["get", getter], ["set", setter]
        ],[["accessor"]],
        "%[accessor] = js::makePropertyAccessorValue(new(%[%frame]) js::PropertyAccessor("+
            "js::isFunction(%[get]),"+
            "js::isFunction(%[set])"+
        "));\n"+
        "%[obj].raw.oval->defineOwnPropertyExplicitThrowing(%[%frame], %[prop].raw.sval,"+
        "    js::PROP_HAVE_CONFIGURABLE | js::PROP_CONFIGURABLE |"+
        "    js::PROP_HAVE_ENUMERABLE | js::PROP_ENUMERABLE |"+
        "    js::PROP_GET_SET,"+
        "  %[accessor]"+
        ");"
    );
}

function toObject (x)
{
    return __asm__({},["res"], [["x", x]], [],
        "%[res] = js::makeObjectValue(js::toObject(%[%frame], %[x]));"
    );
}

function needObject (obj, msgPrefix)
{
    if (obj === null || typeof obj !== "object" && typeof obj !== "function")
        throw new TypeError(msgPrefix + " with a non-object");
}

function defineProperty (obj, prop, descriptor)
{
    needObject(obj, "defineProperty()");

    if (descriptor === void 0)
        descriptor = {};

    if (("get" in descriptor) && typeof descriptor.get !== "function")
        throw new TypeError("'get' is not a function");
    if (("set" in descriptor) && typeof descriptor.set !== "function")
        throw new TypeError("'set' is not a function");

    var value;
    var haveValue = false;
    var getset = false;
    if (descriptor.get || descriptor.set) {
        if (("value" in descriptor) || ("writable" in descriptor))
            throw new TypeError("Cannot specify 'value' or 'writable' with get/set");

        getset = true;
        __asm__({},[],[["get", descriptor.get], ["set", descriptor.set], ["value", value]],[],
            "%[value] = js::makePropertyAccessorValue(new(%[%frame]) js::PropertyAccessor("+
            "js::isFunction(%[get]),"+
            "js::isFunction(%[set])"+
            "));"
        );
    } else {
        haveValue = "value" in descriptor;
        value = descriptor.value;
    }

    __asm__({},[],[
            ["obj", obj], ["prop", String(prop)],
            ["haveValue", haveValue],                           ["value", value],
            ["haveConfigurable", "configurable" in descriptor], ["configurable", !!descriptor.configurable],
            ["haveEnumerable", "enumerable" in descriptor],     ["enumerable", !!descriptor.enumerable],
            ["haveWritable", "writable" in descriptor],         ["writable", !!descriptor.writable],
            ["getset", getset]
        ],[],
        "%[obj].raw.oval->defineOwnPropertyExplicitThrowing(%[%frame], %[prop].raw.sval,"+
        "    (%[haveConfigurable].raw.bval ? js::PROP_HAVE_CONFIGURABLE : 0) |"+
        "    (%[configurable].raw.bval ? js::PROP_CONFIGURABLE : 0) |"+
        "    (%[haveEnumerable].raw.bval ? js::PROP_HAVE_ENUMERABLE : 0) |"+
        "    (%[enumerable].raw.bval ? js::PROP_ENUMERABLE : 0) |"+
        "    (%[haveWritable].raw.bval ? js::PROP_HAVE_WRITABLE : 0) |"+
        "    (%[writable].raw.bval ? js::PROP_WRITEABLE : 0) |"+
        "    (%[getset].raw.bval ? js::PROP_GET_SET : 0) |" +
        "    (%[haveValue].raw.bval ? js::PROP_HAVE_VALUE : 0),"+
        "  %[value]"+
        ");"
    );

    return obj;
}

function defineProperties (obj, props)
{
    needObject(obj, "defineProperties()");

    for ( var pn in Object(props) )
        defineProperty(obj, pn, props[pn]);

    return obj;
}

function hidden (obj, prop, func)
{
    defineProperty(obj, prop, {writable: true, configurable: true, value: func});
}

function getter (obj, prop, func)
{
    defineProperty(obj, prop, {configurable: true, get: func});
}
function accessor (obj, prop, getF, setF)
{
    defineProperty(obj, prop, {configurable: true, get: getF, set: setF});
}

function constProp (obj, prop, value)
{
    defineProperty(obj, prop, {value: value, writable: false});
}

function sealPrototype (obj, value)
{
    constProp(obj, "prototype", value);
}

function isCallable (x)
{
    return typeof(x) === "function";
}

// $jsc
//
$jsc = {};

defineProperty($jsc, "createNative", {value: createNative});
defineProperty($jsc, "getInternalClass", {value: getInternalClass});

defineProperty($jsc, "ICLS_MEMORY"           , {value: ICLS_MEMORY});
defineProperty($jsc, "ICLS_STRING_PRIM"      , {value: ICLS_STRING_PRIM});
defineProperty($jsc, "ICLS_UNDEFINED"        , {value: ICLS_UNDEFINED});
defineProperty($jsc, "ICLS_NULL"             , {value: ICLS_NULL});
defineProperty($jsc, "ICLS_OBJECT"           , {value: ICLS_OBJECT});
defineProperty($jsc, "ICLS_ARGUMENTS"        , {value: ICLS_ARGUMENTS});
defineProperty($jsc, "ICLS_ARRAY"            , {value: ICLS_ARRAY});
defineProperty($jsc, "ICLS_FUNCTION"         , {value: ICLS_FUNCTION});
defineProperty($jsc, "ICLS_BOOLEAN"          , {value: ICLS_BOOLEAN});
defineProperty($jsc, "ICLS_NUMBER"           , {value: ICLS_NUMBER});
defineProperty($jsc, "ICLS_STRING"           , {value: ICLS_STRING});
defineProperty($jsc, "ICLS_ERROR"            , {value: ICLS_ERROR});
defineProperty($jsc, "ICLS_REGEXP"           , {value: ICLS_REGEXP});
defineProperty($jsc, "ICLS_DATE"             , {value: ICLS_DATE});
defineProperty($jsc, "ICLS_JSON"             , {value: ICLS_JSON});
defineProperty($jsc, "ICLS_MATH"             , {value: ICLS_MATH});
defineProperty($jsc, "ICLS_ArrayBuffer"      , {value: ICLS_ArrayBuffer});
defineProperty($jsc, "ICLS_DataView"         , {value: ICLS_DataView});
defineProperty($jsc, "ICLS_Int8Array"        , {value: ICLS_Int8Array});
defineProperty($jsc, "ICLS_Uint8Array"       , {value: ICLS_Uint8Array});
defineProperty($jsc, "ICLS_Uint8ClampedArray", {value: ICLS_Uint8ClampedArray});
defineProperty($jsc, "ICLS_Int16Array"       , {value: ICLS_Int16Array});
defineProperty($jsc, "ICLS_Uint16Array"      , {value: ICLS_Uint16Array});
defineProperty($jsc, "ICLS_Int32Array"       , {value: ICLS_Int32Array});
defineProperty($jsc, "ICLS_Uint32Array"      , {value: ICLS_Uint32Array});
defineProperty($jsc, "ICLS_Float32Array"     , {value: ICLS_Float32Array});
defineProperty($jsc, "ICLS_Float64Array"     , {value: ICLS_Float64Array});

constProp($jsc, "newInitTag", newInitTag);
constProp($jsc, "setInitTag", setInitTag);
constProp($jsc, "checkInitTag", checkInitTag);

// Object
//
function object_protoGetter ()
{
    return __asm__({},["result"],[["this",this]],[],
        "%[result] = js::toObject(%[%frame], %[this])->getParentValue()"
    );
}

function object_protoSetter ()
{
    throw TypeError("setting of __proto__ is not supported");
}

accessor(Object.prototype, "__proto__", object_protoGetter, object_protoSetter);

hidden(Object, "getPrototypeOf", function object_getPrototypeOf(O)
{
    needObject(O, "getPrototypeOf");
    return __asm__({},["result"],[["O",O]],[],
        "%[result] = %[O].raw.oval->getParentValue()"
    );
});

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

hidden(Object, "keys", function object_keys (O)
{
    needObject(O, "Object.keys");
    return __asm__({},["res"],[["O", O]], [],
        "%[res] = js::makeObjectValue(%[O].raw.oval->ownKeys(%[%frame]));"
    );
});

hidden(Object, "freeze", function object_freeze(O)
{
    needObject(O, "Object.freeze");
    __asm__({},[],[["O", O]], [], "%[O].raw.oval->freeze();");
});

hidden(Object, "seal", function object_seal(O)
{
    needObject(O, "Object.seal");
    __asm__({},[],[["O", O]], [], "%[O].raw.oval->seal();");
});

hidden(Object, "preventExtensions", function object_preventExtensions(O)
{
    needObject(O, "Object.preventExtensions");
    __asm__({},[],[["O", O]], [], "%[O].raw.oval->preventExtensions();");
});

hidden(Object.prototype, "toString", function object_toString()
{
    switch (getInternalClass(this)) {
        case  0: // ICLS_MEMORY
        case  2: return "[object Undefined]"; // ICLS_UNDEFINED
        case  3: return "[object Null]";      // ICLS_NULL
        default:
        case  4: return "[object Object]";    // ICLS_OBJECT
        case  5: return "[object Arguments]"; // ICLS_ARGUMENTS
        case  6: return "[object Array]";     // ICLS_ARRAY
        case  7: return "[object Function]";  // ICLS_FUNCTION
        case  8: return "[object Boolean]";   // ICLS_BOOLEAN
        case  9: return "[object Number]";    // ICLS_NUMBER
        case  1:                              // ICLS_STRING_PRIM
        case 10: return "[object String]";    // ICLS_STRING
        case 11: return "[object Error]";     // ICLS_STRING
        case 12: return "[object RegExp]";    // ICLS_REGEXP
        case 13: return "[object Date]";      // ICLS_DATE
        case 14: return "[object JSON]";      // ICLS_JSON
        case 15: return "[object Math]";      // ICLS_MATH
        case 16: return "[object ArrayBuffer]";  // ICLS_ArrayBuffer
        case 17: return "[object DataView]";     // ICLS_DataView
        case 18: return "[object Int8Array]";    // ICLS_Int8Array
        case 19: return "[object Uint8Array]";   // ICLS_Uint8Array
        case 20: return "[object Uint8ClampedArray]"; // ICLS_Uint8ClampedArray
        case 21: return "[object Int16Array]";   // ICLS_Int16Array
        case 22: return "[object Uint16Array]";  // ICLS_Uint16Array
        case 23: return "[object Int32Array]";   // ICLS_Int32Array
        case 24: return "[object Uint32Array]";  // ICLS_Uint32Array
        case 25: return "[object Float32Array]"; // ICLS_Float32Array
        case 26: return "[object Float64Array]"; // ICLS_Float64Array
    }
});

hidden(Object.prototype, "toLocaleString", function object_toLocaleString()
{
    return this.toString();
});

hidden(Object.prototype, "hasOwnProperty", function object_hasOwnProperty(V)
{
    var O = toObject(this);
    return __asm__({},["res"],[["O", O], ["V", V]],[],
        "%[res] = js::makeBooleanValue(%[O].raw.oval->hasComputed(%[%frame], %[V], true));"
    );
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

// InternalError
//
InternalError.prototype = Object.create(Error.prototype);
hidden(InternalError.prototype, "name", "InternalError");

// RangeError
//
RangeError.prototype = Object.create(Error.prototype);
hidden(RangeError.prototype, "name", "RangeError");

// URIError
//
URIError.prototype = Object.create(Error.prototype);
hidden(URIError.prototype, "name", "URIError");

// Array
//
function isArrayBase (arg)
{
    switch (getInternalClass(arg)) {
        case 5: // ICLS_ARGUMENTS
        case 6: // ICLS_ARRAY
            return true;
        default:
            return false;
    }
}
function isArrayBaseOfLength (arg, length)
{
    if (isArrayBase(arg))
        return __asm__({},["result"],[["arg", arg], ["length", Number(length)]],[],
            "js::ArrayBase * ab = static_cast<js::ArrayBase*>(%[arg].raw.oval);\n"+
            "%[result] = js::makeBooleanValue(ab->getLength() >= %[length].raw.nval);"
        );
}
function isArray (arg)
{
    return getInternalClass(arg) === ICLS_ARRAY;
}

hidden(Array, "isArray", isArray);

hidden(Array.prototype, "forEach", function array_forEach(callbackFn, thisArg)
{
    var O = toObject(this);
    var len = O.length >>> 0; // toUint32
    if (thisArg === undefined) {
        for ( var k = 0; k < len; ++k )
            if (k in O)
                callbackFn(O[k], k, O);
    } else {
        for ( var k = 0; k < len; ++k )
            if (k in O)
                callbackFn.call(thisArg, O[k], k, O);
    }
});

hidden(Array.prototype, "push", function array_push(dummy)
{
    var O = toObject(this);
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
    var O = toObject(this);
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
 * Copy from an array-like object to an instance of ArrayBase. src and dest could be the same (copying values
 * within the same array).
 *
 * @param dest - must be ArrayBase of sufficient length and it must be filled with "holes" (unless it is the same as src)
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
            "::memmove("+
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
    var O = toObject(this);
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
    var O = toObject(this);
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

hidden(Array.prototype, "join", function array_join (sep)
{
    var O = toObject(this);
    var len = O.length >>> 0; // toUint32()
    if (!len)
        return "";

    sep = (sep === void 0) ? "," : String(sep);

    var R, elem;

    elem = O[0];
    R = elem === void 0 || elem === null ? "" : String(elem);
    for ( var k = 1; k < len; ++k ) {
        elem = O[k];
        R += sep + (elem === void 0 || elem === null ? "" : String(elem));
    }
    return R;
});

hidden(Array.prototype, "splice", function array_splice(start, deleteCount)
{
    var O = toObject(this);

    var len = O.length >>> 0;
    var actualStart;

    if ((actualStart = Number(start)) < 0) {
        if ((actualStart += len) < 0)
            actualStart = 0;
    } else {
        if (actualStart > len)
            actualStart = len;
    }
    actualStart >>>= 0; // toUint32

    var actualDeleteCount;
    if ((actualDeleteCount = Number(deleteCount)) < 0) {
        actualDeleteCount = 0;
    } else {
        var tmp = len - actualStart;
        if (actualDeleteCount > tmp)
            actualDeleteCount = tmp;
    }
    actualDeleteCount >>>= 0; // toUint32

    var A = [];
    A.length = actualDeleteCount;

    if (actualDeleteCount > 0)
        copyToArray(A, 0, O, actualStart, actualStart + actualDeleteCount);

    var itemCount = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(%[%argc] - 3);");
    if (itemCount < 0)
        itemCount = 0;

    if (itemCount > actualDeleteCount)
        O.length += itemCount - actualDeleteCount;

    if (itemCount !== actualDeleteCount) {
        // Shift the rest of the array (actualDeleteCount - itemCount) to the left
        if (isArrayBase(O)) {
            copyToArray(O, actualStart + itemCount, O, actualStart + actualDeleteCount, len);
        } else {
            var destIndex = actualStart + itemCount;
            var srcFrom = actualStart + actualDeleteCount;

            if (destIndex <= srcFrom) {
                for ( var i = srcFrom; i < len; ++i, ++destIndex ) {
                    if (i in O)
                        O[destIndex] = O[i];
                    else
                        delete O[destIndex];
                }

                for ( ; destIndex < len; ++destIndex )
                    delete O[destIndex];
            } else {
                // Copy in reverse direction
                destIndex += (len - srcFrom);
                for ( var i = len; i > srcFrom; ) {
                    --i;
                    --destIndex;
                    if (i in O)
                        O[destIndex] = O[i];
                    else
                        delete O[destIndex];
                }
            }
        }
    }

    if (itemCount < actualDeleteCount)
        O.length += itemCount - actualDeleteCount;


    // copy the new items
    for ( var i = 0; i < itemCount; ++i ) {
        O[actualStart++] = __asm__({},["res"],[["i",i]],[],
            "%[res] = %[%argv][(unsigned)%[i].raw.nval + 3];"
        );
    }

    return A;
});

hidden(Array.prototype, "shift", function array_shift()
{
    var O = toObject(this);

    var len = O.length >>> 0;

    if (len === 0) {
        O.length = 0;
        return undefined;
    }

    var res = O[0];

    if (isArrayBase(O)) {
        copyToArray(O, 0, O, 1, len);
    } else {
        for ( var i = 1; i < len; ++i ) {
            if (i in O)
                O[i-1] = O[i];
            else
                delete O[i-1];
        }

        delete O[len-1];
    }

    O.length = len - 1;
    return res;
});

hidden(Array.prototype, "toString", function array_toString()
{
    var array = toObject(this);
    var func = array.join;
    if (!isCallable(func))
        func = String.prototype.toString;
    return func.call(array);
});

// Boolean
//
hidden(Boolean.prototype, "toString", function boolean_tostring()
{
    var b;
    if (typeof this === "boolean")
        b = this;
    else if (getInternalClass(this) === ICLS_BOOLEAN)
        b = Boolean(this);
    else
        throw TypeError("Boolean.prototype.toString called with a non-boolean");
    return b ? "true" : "false";
});

hidden(Boolean.prototype, "valueOf", function boolean_valueOf()
{
    if (typeof this === "boolean")
        return this;
    else if (getInternalClass(this) === ICLS_BOOLEAN)
        return Boolean(this);
    else
        throw TypeError("not a boolean");
});

// String
//
hidden(String.prototype, "indexOf", function string_indexOf (searchString, position)
{
    if (this === null || this === undefined)
        throw TypeError("'this' is not coercible to String");
    var S = String(this);
    var searchStr = String(searchString);
    var numPos = +position;
    var start;

    if (numPos < 0)
        start = 0;
    else if (numPos >= S.length)
        return -1;
    else
        start = numPos >>> 0;

    return __asm__({},["result"],[["S", S], ["searchStr", searchStr], ["start", start]],[],
        "const js::StringPrim * haystack = %[S].raw.sval;\n" +
        "bool secondSurr;\n" +
        "const unsigned char * startPos = haystack->charPos((uint32_t)%[start].raw.nval, &secondSurr);\n" +
        "const unsigned char * pos = (const unsigned char *)jsmemmem(" +
            "startPos, haystack->_str + haystack->byteLength - startPos, " +
            "%[searchStr].raw.sval->_str, %[searchStr].raw.sval->byteLength" +
        ");\n" +
        "if (pos)\n" +
        "  %[result] = js::makeNumberValue(haystack->byteOffsetToUTF16Index(pos - haystack->_str));\n" +
        "else\n" +
        "  %[result] = js::makeNumberValue(-1);"
    );
});

hidden(String.prototype, "lastIndexOf", function string_indexOf (searchString, position)
{
    if (this === null || this === undefined)
        throw TypeError("'this' is not coercible to String");
    var S = String(this);
    var searchStr = String(searchString);
    var searchLen = searchStr.length;
    var numPos = +position;
    var start;

    if (numPos < 0)
        return -1;
    else if (isNaN(numPos) || numPos > S.length - searchLen)
        start = S.length - searchLen;
    else
        start = numPos >>> 0;

    return __asm__({},["result"],[["S", S], ["searchStr", searchStr], ["end", start + searchLen]],[],
        "const js::StringPrim * haystack = %[S].raw.sval;\n" +
        "bool secondSurr;\n" +
        "const unsigned char * pos = (const unsigned char *)js::memrmem(" +
            "haystack->_str, (size_t)%[end].raw.nval, " +
            "%[searchStr].raw.sval->_str, %[searchStr].raw.sval->byteLength" +
        ");\n" +
        "if (pos)\n" +
        "  %[result] = js::makeNumberValue(haystack->byteOffsetToUTF16Index(pos - haystack->_str));\n" +
        "else\n" +
        "  %[result] = js::makeNumberValue(-1);"
    );
});

function string_toString ()
{
    if (typeof this === "string")
        return this;
    else if (getInternalClass(this) === ICLS_STRING)
        return String(this);
    else
        throw TypeError("not a string");
}

hidden(String.prototype, "toString", string_toString);
hidden(String.prototype, "valueOf", string_toString);

hidden(String.prototype, "split", function string_split (separator, limit)
{
    if (this === null || this === undefined)
        throw TypeError("'this' not coercible to string");
    var S = String(this);
    var A = [];
    var lim = limit === undefined ? 0xFFFFFFFF : limit >>> 0;

    if (lim === 0)
        return A;

    if (separator === undefined) {
        A[0] = S;
        return A;
    }

    var R = String(separator);
    var Rlen = R.length;

    var lastIndex = 0;
    var index;
    var len = 0;
    while ((index = S.indexOf(R, lastIndex)) >= 0) {
        A[len++] = S.slice(lastIndex, index);
        if (len >= lim)
            return A;
        lastIndex = index + Rlen;
    }
    if (lastIndex < S.length)
        A[len++] = S.slice(lastIndex);

    return A;
});

hidden(String.prototype, "toUpperCase", function string_toUpperCase ()
{
    if (this === null || this === undefined)
        throw TypeError("'this' not coercible to string");
    return __asm__({},["res"],[["S", String(this)]],[],
        "%[res] = js::makeStringValue(js::toUpperCase(%[%frame], %[S].raw.sval));"
    );
});

hidden(String.prototype, "toLowerCase", function string_toLowerCase ()
{
    if (this === null || this === undefined)
        throw TypeError("'this' not coercible to string");
    return __asm__({},["res"],[["S", String(this)]],[],
        "%[res] = js::makeStringValue(js::toLowerCase(%[%frame], %[S].raw.sval));"
    );
});
