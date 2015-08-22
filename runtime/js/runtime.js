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
        "char * endptr;\n" +
        "long val = strtol(s, &endptr, (int)%[radix].raw.nval);" +
        "%[res] = js::makeNumberValue(endptr != s ? val : NAN);"
    );
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

var Math;
