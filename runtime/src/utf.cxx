// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/utf.h"
#include "jsc/common.h"

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

uint32_t utf8Decode (const unsigned char * from, bool * error)
{
    unsigned ch = from[0];
    uint32_t result;

    if (JS_LIKELY((ch & 0x80) == 0)) { // Ordinary ASCII?
        return ch;
    }
    else if (JS_LIKELY((ch & 0xE0) == 0xC0)) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80))
            goto returnError;

        result = ((ch & 0x1F) << 6) | (ch1 & 0x3F);
        if (JS_UNLIKELY(result <= 0x7F))
            goto returnError;
    }
    else if (JS_LIKELY((ch & 0xF0) == 0xE0)) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80))
            goto returnError;

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80))
            goto returnError;

        result = ((ch & 0x0F) << 12) | ((ch1 & 0x3F) << 6) | (ch2 & 0x3F);
        if (JS_UNLIKELY(result <= 0x7FF))
            goto returnError;

        if (JS_UNLIKELY(result >= UNICODE_SURROGATE_LO && result <= UNICODE_SURROGATE_HI))
            goto returnError;
    }
    else if ((ch & 0xF8) == 0xF0) {
        uint32_t ch1 = from[1];
        if (JS_UNLIKELY((ch1 & 0xC0) != 0x80))
            goto returnError;

        uint32_t ch2 = from[2];
        if (JS_UNLIKELY((ch2 & 0xC0) != 0x80))
            goto returnError;

        uint32_t ch3 = from[3];
        if (JS_UNLIKELY((ch3 & 0xC0) != 0x80))
            goto returnError;

        result = ((ch & 0x07) << 18) | ((ch1 & 0x3F) << 12) | ((ch2 & 0x3F) << 6) | (ch3 & 0x3F);
        if (JS_UNLIKELY(result <= 0xFFFF))
            goto returnError;
        if (JS_UNLIKELY(result > UNICODE_MAX_VALUE))
            goto returnError;
    }
    else
        goto returnError;

    return result;

returnError:
    *error = true;
    return UNICODE_REPLACEMENT_CHARACTER;
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
