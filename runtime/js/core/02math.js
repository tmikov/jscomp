// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

Math = createNative(0);
setInternalClass(Math, ICLS_MATH);

constProp(Math, "E",      2.718281828459045);
constProp(Math, "LN10",   2.302585092994046);
constProp(Math, "LN2",    0.6931471805599453);
constProp(Math, "LOG2E",  1.4426950408889634);
constProp(Math, "LOG10E", 0.4342944819032518);
constProp(Math, "PI",     3.1415926535897932);
constProp(Math, "SQRT1_2",0.7071067811865476);
constProp(Math, "SQRT2",  1.4142135623730951);

hidden(Math, "abs", function math_abs (x)
{
    x = +x;
    return x < 0 ? -x : x;
});

hidden(Math, "ceil", function math_ceil (x)
{
    return __asm__({},["res"], [["x", +x]], [],
        "%[res] = js::makeNumberValue(::ceil(%[x].raw.nval));"
    );
});

hidden(Math, "floor", function math_floor (x)
{
    return __asm__({},["res"], [["x", +x]], [],
        "%[res] = js::makeNumberValue(::floor(%[x].raw.nval));"
    );
});

hidden(Math, "max", function math_max (a, b)
{
    var res = -Infinity;
    var argc = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(%[%argc])");
    for ( var i = 1; i < argc; ++i ) {
        var arg = +__asm__({},["res"],[["i",i]],[],"%[res] = %[%argv][(unsigned)%[i].raw.nval]");
        if (isNaN(arg))
            return NaN;
        if (arg > res)
            res = arg;
    }
    return res;
});

hidden(Math, "min", function math_min (a, b)
{
    var res = Infinity;
    var argc = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(%[%argc])");
    for ( var i = 1; i < argc; ++i ) {
        var arg = +__asm__({},["res"],[["i",i]],[],"%[res] = %[%argv][(unsigned)%[i].raw.nval]");
        if (isNaN(arg))
            return NaN;
        if (arg < res)
            res = arg;
    }
    return res;
});
