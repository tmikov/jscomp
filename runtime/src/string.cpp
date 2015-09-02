// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsruntime.h"

namespace js {

namespace {
    // FIXME: it only converts ASCII characters!
    template <typename F>
    const StringPrim * convert (StackFrame * caller, const StringPrim * str, F cvt)
    {
        if (str->byteLength == 0)
            return str;

        StringPrim * res = StringPrim::makeEmpty(caller, str->byteLength);
        const unsigned char * s = str->_str;
        const unsigned char * e = str->_str + str->byteLength;
        unsigned char * d = res->_str;
        bool changed = false;

        while (s < e) {
            uint32_t cp;
            s = utf8Decode(s, &cp);
            if (JS_UNLIKELY(cp == UNICODE_ERROR)) // that is actually impossible
                return str; // Invalid string. Instead of crashing, just return the source

            d += utf8Encode(d, cvt(cp, changed));
        }

        assert(d - res->_str == res->byteLength);
        if (changed) {
            res->init(str->charLength);
            return res;
        } else {
            return str;
        }
    }
}; // anonymous napespace

const StringPrim * toLowerCase (StackFrame * caller, const StringPrim * str)
{
    struct lower {
        uint32_t operator() (uint32_t cp, bool & changed) {
            if (cp >= 'A' && cp <= 'Z') {
                changed = true;
                return cp ^ 32;
            } else
                return cp;
        }
    };
    return convert(caller, str, lower());
};

const StringPrim * toUpperCase (StackFrame * caller, const StringPrim * str)
{
    struct upper {
        uint32_t operator() (uint32_t cp, bool & changed) {
            if (cp >= 'a' && cp <= 'z') {
                changed = true;
                return cp ^ 32;
            } else
                return cp;
        }
    };
    return convert(caller, str, upper());
};

}; // namespace js
