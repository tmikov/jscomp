// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsruntime.h"
#include "jsc/dtoa.h"
#include "jsc/jsimpl.h"

#include <float.h>

namespace js {

static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";

const StringPrim * uint32ToString (StackFrame * caller, uint32_t n, int radix)
{
    char buf[40]; // The largest buffer we would need is for base 2 - 32 bits plus a zero
    char * s = buf;

    do {
        *s++ = digits[n % radix];
        n /= radix;
    } while (n != 0);

    unsigned len = s - buf;
    StringPrim * res = StringPrim::makeEmpty(caller, len);
    unsigned char * d = res->_str;
    do
        *d++ = *--s;
    while (s != buf);

    res->init(len);
    return res;
}

const StringPrim * numberToString (StackFrame * caller, double n, int radix)
{
    if (isnan(n))
        return JS_GET_RUNTIME(caller)->permStrNaN;
    if (!isfinite(n))
        return n < 0 ? JS_GET_RUNTIME(caller)->permStrMinusInfinity : JS_GET_RUNTIME(caller)->permStrInfinity;

    if (radix == 10) {
        char buf[32];
        g_fmt(buf, n) ;
        return StringPrim::makeFromValid(caller, buf);
    }

    // A very dumb, inaccurate, etc, algorithm, but should suffice for now
    StringBuilder buf(caller, 128);
    if (n < 0) {
        buf.add(caller, '-');
        n = -n;
    }

    double whole = ::floor(n);
    double fract = n - whole;

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

double parseInt (StackFrame * caller, const char * s, int radix)
{
    while (isspace(*s))
        ++s;

    int sign = 1;
    if (*s == '+')
        ++s;
    else if (*s == '-') {
        ++s;
        sign = -1;
    }

    if (radix == 0) {
        if (s[0] == '0' && (s[1] | 32) == 'x') { // check for 0x
            s += 2; // skip over the 0x
            radix = 16;
        } else {
            radix = 10;
        }
    }
    else if (radix < 2 || radix > 36)
        return NAN;

    if (radix == 16 && s[0] == '0' && (s[1] | 32) == 'x')
        s += 2; // skip over the 0x

    int lastDigit, lastLetter;

    if (radix <= 10) {
        lastDigit = lastLetter = radix + ('0' - 1);
    } else {
        lastDigit = '9';
        lastLetter = radix + ('a' - 10 - 1);
    }

    const char * start = s; // save the start of the string. We might need it later

    int ch = *s++ | 32;
    if (ch >= '0' && ch <= lastDigit)
        ch -= '0';
    else if (ch >= 'a' && ch <= lastLetter)
        ch -= 'a' - 10;
    else
        return NAN; // First character isn't a digit

    int32_t ires = ch;
    for (;;) {
        ch = *s++ | 32;
        if (ch >= '0' && ch <= lastDigit)
            ch -= '0';
        else if (ch >= 'a' && ch <= lastLetter)
            ch -= 'a' - 10;
        else
            break;

        int32_t n = ires * radix + ch;
        if (JS_UNLIKELY(n < ires)) // overflow?
            goto floatLoop;

        ires = n;
    }

    return (double)(ires * sign);

    // We arrive here if the conversion doesn't fit in a 32-bit int
floatLoop:
    // For radix 10 we want to use g_strtod()
    double fres;

    if (radix == 10) {
        char * buf = NULL;

        // Check if the string could be interpreted as float by g_strtod()
        s = start;
        while (*s >= '0' && *s <= '9')
            ++s;

        // The string doesn't consist entirely of integer digits, strtod() might get confused.
        // Copy only the integer digits into a new string
        if (*s != 0) {
            size_t len = s - start;
            buf = (char *)malloc(len+1);
            if (!buf)
                throwOutOfMemory(caller);
            memcpy(buf, start, len);
            buf[len] = 0; // Zero terminate
            start = buf;
        }

        char * e;
        fres = strtod(start, &e);

        if (buf)
            free(buf);
    } else {
        double fradix = radix;
        fres = (double)ires * fradix + ch;

        for(;;)
        {
            ch = *s++ | 32;
            if (ch >= '0' && ch <= lastDigit)
                ch -= '0';
            else if (ch >= 'a' && ch <= lastLetter)
                ch -= 'a' - 10;
            else
                break;

            fres = fres * fradix + ch;
        }
    }

    return fres * sign;
}


}; // js
