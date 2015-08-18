// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_JSIMPL_H
#define JSCOMP_JSIMPL_H

#ifndef JSCOMP_JSRUNTIME_H
#include "jsc/jsruntime.h"
#endif

namespace js {

// Need our own definition to avoid warnings when using it on C++ objects
#define OFFSETOF(type, field)  ((char*)&(((type*)0)->field) - ((char*)0) )

/**
 * Return true if "value" is representable as uint32_t, and store the uint32_t value in "res"
 */
#define IS_FAST_UINT32(value,res)  ((value).tag == VT_NUMBER && ((res) = (uint32_t)(value).raw.nval) == (value).raw.nval)
#define IS_FAST_INT32(value,res)   ((value).tag == VT_NUMBER && ((res) = (int32_t)(value).raw.nval) == (value).raw.nval)

}; // namespace js

#endif //JSCOMP_JSIMPL_H
