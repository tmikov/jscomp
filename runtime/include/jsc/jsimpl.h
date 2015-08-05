// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_JSIMPL_H
#define JSCOMP_JSIMPL_H

#include "jsc/runtime.h"

namespace js {

/**
 * Return true if "value" is representable as uint32_t, and store the uint32_t value in "res"
 */
#define IS_FAST_UINT32(value,res)  ((value).tag == VT_NUMBER && ((res) = (uint32_t)(value).raw.nval) == (value).raw.nval)
#define IS_FAST_INT32(value,res)   ((value).tag == VT_NUMBER && ((res) = (int32_t)(value).raw.nval) == (value).raw.nval)

}; // namespace js

#endif //JSCOMP_JSIMPL_H
