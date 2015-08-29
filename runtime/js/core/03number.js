// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

hidden(Number.prototype, "toString", function number_toString (radix)
{
    if (getInternalClass(this) !== ICLS_NUMBER)
        throw TypeError("'this' is not a number");

    var n = Number(this);

    if (radix === void 0)
        radix = 10;
    else {
        radix = +radix; // toNumber
        if (radix < 2 || radix > 36)
            throw new RangeError("invalid radix");
        radix = radix | 0; // Now that we know it is in a safe range, convert to integer
    }

    return __asm__({},["res"],[["n", n], ["radix", radix]],[],
        "%[res] = js::makeStringValue(js::numberToString(%[%frame], %[n].raw.nval, (int)%[radix].raw.nval));"
    );

});
