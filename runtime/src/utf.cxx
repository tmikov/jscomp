// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/utf.h"
#include "jsc/common.h"

#include <stddef.h>

namespace js {

unsigned utf8Encode ( unsigned char * dst, uint32_t cp )
{
    if (cp <= 0x7F) {
        *dst = (char)cp;
        return 1;
    }
    else if (cp <= 0x7FF) {
        dst[1] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[0] = (cp & 0x1F) | 0xC0;
        return 2;
    }
    else if (cp <= 0xFFFF) {
        dst[2] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[1] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[0] = (cp & 0x0F) | 0xE0;
        return 3;
    }
    else if (cp <= 0x1FFFFF) {
        dst[3] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[2] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[1] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[0] = (cp & 0x07) | 0xF0;
        return 4;
    }
    else if (cp <= 0x3FFFFFF) {
        dst[4] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[3] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[2] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[1] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[0] = (cp & 0x03) | 0xF8;
        return 5;
    }
    else {
        dst[5] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[4] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[3] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[2] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[1] = (cp & 0x3F) | 0x80;
        cp >>= 6;
        dst[0] = (cp & 0x01) | 0xFC;
        return 6;
    }
}

unsigned utf8EncodedLength (uint32_t cp)
{
    if (cp <= 0x7F)
        return 1;
    else if (cp <= 0x7FF)
        return 2;
    else if (cp <= 0xFFFF)
        return 3;
    else if (cp <= 0x1FFFFF)
        return 4;
    else if (cp <= 0x3FFFFFF)
        return 5;
    else
        return 6;
}


unsigned utf8Length (const unsigned char * from, const unsigned char * to)
{
    unsigned length = 0;

    while (from < to) {
        ++length;
        from += utf8CodePointLength(*from);
    }

    return length;
}

const unsigned char * utf8Decode (const unsigned char * from, uint32_t * res)
{
    unsigned ch = from[0];
    uint32_t tmp;

    if (JS_LIKELY((ch & 0x80) == 0)) { // Ordinary ASCII?
        *res = ch;
        return from + 1;
    }
    else if (JS_LIKELY((ch & 0xE0) == 0xC0)) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 1;
        }

        tmp = ((ch & 0x1F) << 6) | (ch1 & 0x3F);
        if (JS_UNLIKELY(tmp <= 0x7F))
            tmp = UNICODE_ERROR;

        *res = tmp;
        return from + 2;
    }
    else if (JS_LIKELY((ch & 0xF0) == 0xE0)) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 1;
        }

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 2;
        }

        tmp = ((ch & 0x0F) << 12) | ((ch1 & 0x3F) << 6) | (ch2 & 0x3F);
        if (JS_UNLIKELY(tmp <= 0x7FF ||
                        tmp >= UNICODE_SURROGATE_LO && tmp <= UNICODE_SURROGATE_HI))
            tmp = UNICODE_ERROR;

        *res = tmp;
        return from + 3;
    }
    else if ((ch & 0xF8) == 0xF0) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 1;
        }

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 2;
        }

        uint32_t ch3 = from[3];
        if (JS_UNLIKELY((ch3 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 3;
        }

        tmp = ((ch & 0x07) << 18) | ((ch1 & 0x3F) << 12) | ((ch2 & 0x3F) << 6) | (ch3 & 0x3F);
        if (JS_UNLIKELY(tmp <= 0xFFFF || tmp > UNICODE_MAX_VALUE))
            tmp = UNICODE_ERROR;

        *res = tmp;
        return from + 4;
    }
    else if ((ch & 0xFC) == 0xF8) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 1;
        }

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 2;
        }

        uint32_t ch3 = from[3];
        if (JS_UNLIKELY((ch3 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 3;
        }

        uint32_t ch4 = from[4];
        if (JS_UNLIKELY((ch4 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 4;
        }

        //tmp = ((ch & 3) << 24) | ((ch1 & 0x3F) << 18) | ((ch2 & 0x3F) << 12) | ((ch3 & 0x3F) << 6) | (ch4 & 0x3F);
        *res = UNICODE_ERROR;
        return from + 4;
    }
    else if ((ch & 0xFE) == 0xFC) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 1;
        }

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 2;
        }

        uint32_t ch3 = from[3];
        if (JS_UNLIKELY((ch3 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 3;
        }

        uint32_t ch4 = from[4];
        if (JS_UNLIKELY((ch4 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 4;
        }

        uint32_t ch5 = from[5];
        if (JS_UNLIKELY((ch5 & 0xC0) != 0x80)) {
            *res = UNICODE_ERROR;
            return from + 5;
        }

        //tmp = ((ch & 1) << 30) | ((ch1 & 0x3F) << 24) | ((ch2 & 0x3F) << 18) | ((ch3 & 0x3F) << 12) | ((ch4 & 0x3F) << 6) | (ch5 & 0x3F);
        *res = UNICODE_ERROR;
        return from + 4;
    }
    else {
        *res = UNICODE_ERROR;
        return from + 1;
    }
}

uint32_t utf8DecodeFast (const unsigned char * from)
{
    unsigned ch = from[0];

    if (JS_LIKELY((ch & 0x80) == 0)) { // Ordinary ASCII?
        return ch;
    }
    else if (JS_LIKELY((ch & 0xE0) == 0xC0)) {
        uint32_t ch1 = from[1];
        return ((ch & 0x1F) << 6) | (ch1 & 0x3F);
    }
    else if (JS_LIKELY((ch & 0xF0) == 0xE0)) {
        uint32_t ch1 = from[1];
        uint32_t ch2 = from[2];
        return ((ch & 0x0F) << 12) | ((ch1 & 0x3F) << 6) | (ch2 & 0x3F);
    }
    else {
        uint32_t ch1 = from[1];
        uint32_t ch2 = from[2];
        uint32_t ch3 = from[3];
        return ((ch & 0x07) << 18) | ((ch1 & 0x3F) << 12) | ((ch2 & 0x3F) << 6) | (ch3 & 0x3F);
    }
}
}; // namespace js
