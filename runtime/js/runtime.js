// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

// Global

function isNaN (number)
{
    return __asm__({},["result"],[["number", Number(number)]],[],
        "%[result] = js::makeBooleanValue(isnan(%[number].raw.nval))"
    );
}

function isFinite (number)
{
    return __asm__({},["result"],[["number", Number(number)]],[],
        "%[result] = js::makeBooleanValue(isfinite(%[number].raw.nval))"
    );
}

function parseInt (string, radix)
{
    var inputString = String(string);
    var R = radix === undefined ? 0 : radix | 0;

    if (R !== 0 && (R < 2 || R > 36))
        return NaN;

    return __asm__({},["res"],[["inputString",inputString],["radix",radix]],[],
        "const char * s = %[inputString].raw.sval->getStr();\n" +
        "%[res] = js::makeNumberValue(js::parseInt(%[%frame], s, (int)%[radix].raw.nval));"
    );
}

function parseFloat (string)
{
    var inputString = String(string);

    return __asm__({},["res"],[["inputString",inputString]],[],
        "const char * s = %[inputString].raw.sval->getStr();\n" +
        "%[res] = js::makeNumberValue(js::parseFloat(%[%frame], s));"
    );
}

function decodeURI (encodedURI)
{
    var uriString = String(encodedURI);

    __asmh__({}, '#include "jsc/uri.h"');
    var res = __asm__({},["res"],[["uriString", uriString]],[],
        "const js::StringPrim * s = %[uriString].raw.sval;\n" +
        "const js::StringPrim * res = js::uriDecode(%[%frame], s->_str, s->_str + s->byteLength, &js::uriDecodeSet);\n" +
        "%[res] = res ? js::makeStringValue(res) : JS_NULL_VALUE;"
    );
    if (res === null)
        throw new URIError("Invalid URI string to decode");
    return res;
}

function decodeURIComponent (encodedURI)
{
    var uriString = String(encodedURI);

    __asmh__({}, '#include "jsc/uri.h"');
    var res = __asm__({},["res"],[["uriString", uriString]],[],
        "const js::StringPrim * s = %[uriString].raw.sval;\n" +
        "const js::StringPrim * res = js::uriDecode(%[%frame], s->_str, s->_str + s->byteLength, &js::uriEmptySet);\n" +
        "%[res] = res ? js::makeStringValue(res) : JS_NULL_VALUE;"
    );
    if (res === null)
        throw new URIError("Invalid URI string to decode");
    return res;
}

function encodeURI (uri)
{
    var uriString = String(uri);

    __asmh__({}, '#include "jsc/uri.h"');
    var res = __asm__({},["res"],[["uriString", uriString]],[],
        "const js::StringPrim * s = %[uriString].raw.sval;\n" +
        "const js::StringPrim * res = js::uriEncode(%[%frame], s->_str, s->_str + s->byteLength, &js::uriEncodeSet);\n" +
        "%[res] = res ? js::makeStringValue(res) : JS_NULL_VALUE;"
    );
    if (res === null)
        throw new URIError("Invalid URI string to encode");
    return res;
}

function encodeURIComponent (uri)
{
    var uriString = String(uri);

    __asmh__({}, '#include "jsc/uri.h"');
    var res = __asm__({},["res"],[["uriString", uriString]],[],
        "const js::StringPrim * s = %[uriString].raw.sval;\n" +
        "const js::StringPrim * res = js::uriEncode(%[%frame], s->_str, s->_str + s->byteLength, &js::uriEncodeComponentSet);\n" +
        "%[res] = res ? js::makeStringValue(res) : JS_NULL_VALUE;"
    );
    if (res === null)
        throw new URIError("Invalid URI string to encode");
    return res;
}

// SyntaxError
//
// NOTE: Error and TypeError are system-declared but the rest of the errors aren't
function SyntaxError (message)
{
    return Error.call(this !== void 0 ? this : Object.create(SyntaxError.prototype), message);
}

function InternalError (message)
{
    return Error.call(this !== void 0 ? this : Object.create(InternalError.prototype), message);
}

function RangeError (message)
{
    return Error.call(this !== void 0 ? this : Object.create(RangeError.prototype), message);
}

function URIError (message)
{
    return Error.call(this !== void 0 ? this : Object.create(URIError.prototype), message);
}

var Math;
var RegExp;
var Date;
var global;
