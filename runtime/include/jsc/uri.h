// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_URI_H
#define JSCOMP_URI_H

#ifndef JSCOMP_OBJECTS_H
#include "jsc/objects.h"
#endif

namespace js {

struct URICharSet;

extern URICharSet const uriEmptySet;
extern URICharSet const uriDecodeSet;
extern URICharSet const uriEncodeSet;
extern URICharSet const uriEncodeComponentSet;

const StringPrim * uriEncode (
    StackFrame * caller, const unsigned char * b, const unsigned char * e, const URICharSet * unescapedSet
);
const StringPrim * uriDecode (
    StackFrame * caller, const unsigned char * b, const unsigned char * e, const URICharSet * reservedSet
);

}; // namespace js

#endif //JSCOMP_URI_H
