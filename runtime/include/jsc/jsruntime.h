// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_JSRUNTIME_H
#define JSCOMP_JSRUNTIME_H

#ifndef JSCOMP_OBJECTS_H
#include "jsc/objects.h"
#endif
#ifndef JSCOMP_TYPEDARRAYS_H
#include "jsc/typedarrays.h"
#endif

namespace js {

void mathInitRandom ();
double mathRandom ();

// string
const StringPrim * toLowerCase (StackFrame * caller, const StringPrim * str);
const StringPrim * toUpperCase (StackFrame * caller, const StringPrim * str);
const void * _memmem (const void * big, size_t biglen, void * little, size_t littlelen);
const void * memrmem (const void * big, size_t biglen, void * little, size_t littlelen);

#ifdef HAVE_GOOD_MEMMEM
#define jsmemmem ::memmem
#else
#define jsmemmem js::_memmem
#endif

};

#endif //JSCOMP_JSRUNTIME_H
