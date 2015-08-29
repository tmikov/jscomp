// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsruntime.h"
#include "jsc/dtoa.h"
#include "jsc/jsimpl.h"

#include <float.h>

namespace js {

const StringPrim * numberToString (StackFrame * caller, double n, int radix)
{
    if (isnan(n))
        return JS_GET_RUNTIME(caller)->permStrNaN;
    if (!isfinite(n))
        return n < 0 ? JS_GET_RUNTIME(caller)->permStrMinusInfinity : JS_GET_RUNTIME(caller)->permStrInfinity;

    if (radix == 10) {
        char buf[32];
        g_fmt(buf, n) ;
        return StringPrim::make(caller, buf);
    }

    // A very dumb, inaccurate, etc, algorithm, but should suffice for now
    StringBuilder buf(caller, 128);
    if (n < 0) {
        buf.add(caller, '-');
        n = -n;
    }

    double whole = ::floor(n);
    double fract = n - whole;
    static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";

    size_t startPos = buf.getLen();
    do {
        char d = digits[(unsigned)fmod(whole, radix)];
        buf.add(caller, d);
        whole /= radix;
    } while (whole >= 1.0);
    buf.reverse(startPos, buf.getLen());

    if (fract > DBL_EPSILON) {
        buf.add(caller, '.');
        unsigned count = 0;
        while (fract > 0 && count < 1024) {
            fract *= radix;
            double d = floor(fract);
            buf.add(caller, digits[(unsigned)d]);
            fract -= d;
            ++count;
        }
    }

    return buf.toStringPrim(caller);
};

double parseFloat (StackFrame * caller, const char * s)
{
    while (isspace(*s))
        ++s;
    // Normally [g_]strtod() does a case insensitive check for Infinity and NaN, which we cannot allow. We have compiled
    // out g_strtod with NO_INFNAN_CHECK to prevent the checking entirely
    const char * t = s;
    bool minus = false;
    if (*t == '+') // skip the sign
        ++t;
    else if (*t == '-') {
        minus = true;
        ++t;
    }
    if (isalpha(*t)) {
        if (strncmp(t, "Infinity", 8) == 0)
            return minus ? -INFINITY : INFINITY;
        // In all other cases return NAN. The strings is either "NaN", or is invalid, and in both cases we return the
        // the same result
        return NAN;
    }

    char * e;
    double res = g_strtod(s, &e);
    if (JS_UNLIKELY(e == s))
        return NAN;
    return res;
}


}; // js
