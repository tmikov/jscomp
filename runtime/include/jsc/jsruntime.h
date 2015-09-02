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


};

#endif //JSCOMP_JSRUNTIME_H
