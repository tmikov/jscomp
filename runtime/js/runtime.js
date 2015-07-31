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

// SyntaxError
//
// NOTE: Error and TypeError are system-declared but the rest of the errors aren't
function SyntaxError (message)
{
    return Error.call(this !== void 0 ? this : Object.create(SyntaxError.prototype), message);
}
