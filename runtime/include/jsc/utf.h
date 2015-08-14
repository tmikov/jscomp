// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_UTF_H
#define JSCOMP_UTF_H

#include "jsc/common.h"
#include <cstdint>

namespace js {


const uint32_t UNICODE_MAX_VALUE             = 0x10FFFF;
const uint32_t UNICODE_SURROGATE_LO          =   0xD800;
const uint32_t UNICODE_SURROGATE_HI          =   0xDFFF;
const uint32_t UNICODE_REPLACEMENT_CHARACTER =   0xFFFD;

inline bool isValidCodePoint ( uint32_t cp )
{
    return !((cp >= UNICODE_SURROGATE_LO && cp <= UNICODE_SURROGATE_HI) || cp > UNICODE_MAX_VALUE);
}

inline unsigned utf8CodePointLength (unsigned char firstByte)
{
    if (JS_LIKELY((firstByte & 0x80) == 0)) // Ordinary ASCII?
        return 1;
    else if (JS_LIKELY((firstByte & 0xE0) == 0xC0))
        return 2;
    else if (JS_LIKELY((firstByte & 0xF0) == 0xE0))
        return 3;
    else if ((firstByte & 0xF8) == 0xF0)
        return 4;
    else
        return 1;
}

/**
 *
 * @param dst  buffer big enough to hold at least 6 bytes
 * @param codePoint
 * @return the number of characters stored
 */
unsigned utf8Encode (unsigned char * dst, uint32_t codePoint);
unsigned utf8Length (const unsigned char * from, const unsigned char * to);

/*
 * Decode one utf-8 code point. We always require the input buffer be zero-terminated. That guarantees us safety
 * even when it is invalid (e.g. partial utf-8 sequence). The terminating zero will be an invalid character and
 * we never access more than that.
 *
 * @param from a zero-terminated buffer.
 */
uint32_t utf8Decode (const unsigned char * from);

/**
 * Decode from a source which is guaranteed to be valid (thus no checks are necessary)
 */
uint32_t utf8DecodeFast (const unsigned char * from);

}; // namespace js

#endif //JSCOMP_UTF_H
