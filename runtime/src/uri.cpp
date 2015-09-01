// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/uri.h"
#include "jsc/jsimpl.h"

namespace js {

struct URICharSet : public BitSet<128>
{
    URICharSet (const char * initSeq = ""):
        BitSet<128>(initSeq)
    {}
};


#define URI_ALPHA          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
#define URI_DECIMAL_DIGIT  "0123456789"
#define URI_MARK           "-_.!~*'()"

#define URI_RESERVED       ";/?:@&=+$,"
#define URI_UNESCAPED      URI_ALPHA URI_DECIMAL_DIGIT URI_MARK

URICharSet const uriEmptySet("");
URICharSet const uriDecodeSet(URI_RESERVED "#");
URICharSet const uriEncodeSet(URI_RESERVED URI_UNESCAPED "#");
URICharSet const uriEncodeComponentSet(URI_UNESCAPED);

const StringPrim * uriEncode (
    StackFrame * caller, const unsigned char * b, const unsigned char * e, const URICharSet * unescapedSet
)
{
    StringBuilder buf(caller, e - b);

    while (b != e) {
        unsigned char ch = *b;
        if (JS_LIKELY(unescapedSet->check(ch))) {
            buf.add(caller, ch);
            ++b;
        } else {
            unsigned cplen = utf8CodePointLength(ch);
            buf.reserveSpaceFor(caller, cplen*3);
            for ( ; cplen > 0; ++b, --cplen ) {
                buf.addUnsafe('%');
                buf.addUnsafe(toxdigit(*b >> 4));
                buf.addUnsafe(toxdigit(*b & 0x0Fu));
            }
        }
    }

    return buf.toStringPrim(caller);
}

const StringPrim * uriDecode (
    StackFrame * caller, const unsigned char * b, const unsigned char * e, const URICharSet * reservedSet
)
{
    StringBuilder buf(caller, e - b);

    while (b != e) {
        if (JS_LIKELY(*b != '%')) {
            buf.add(caller, *b++);
        } else {
            if (e - b < 3 || !isxdigit(b[1]) || !isxdigit(b[2]))
                return NULL;

            unsigned char ch0 = (unsigned char)((fromxdigit(b[1]) << 4) + fromxdigit(b[2]));
            b += 3;

            if (ch0 < 128) {
                buf.add(caller, ch0);
            } else {
                // UTF-8 encoded character
                unsigned cplen = utf8CodePointLength(ch0);
                // Do we have enough source chars to encode all of it?
                if (e - b < 3 * (cplen - 1))
                    return NULL;

                unsigned char tmp[8];
                tmp[0] = ch0;

                unsigned i;
                for ( i = 1; i < cplen; ++i, b += 3 ) {
                    if (b[0] != '%' || !isxdigit(b[1]) || !isxdigit(b[2]))
                        return NULL;
                    tmp[i] = (unsigned char)((fromxdigit(b[1]) << 4) + fromxdigit(b[2]));
                }
                tmp[i] = 0;

                // Validate the encoded character
                uint32_t decodedCh;
                utf8Decode(tmp, &decodedCh);
                if (decodedCh == UNICODE_ERROR)
                    return NULL;

                if (reservedSet->check(decodedCh))
                    buf.add(caller, b - cplen*3, cplen*3);
                else
                    buf.add(caller, tmp, cplen);
            }
        }
    }

    return buf.toStringPrim(caller);
}

}; // namespace js
