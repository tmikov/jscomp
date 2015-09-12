// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_FS_H
#define JSCOMP_FS_H

#ifndef JSCOMP_OBJECTS_H
#include "jsc/objects.h"
#endif

#ifndef UV_H
#include "uv.h"
#endif

namespace js {

/**
 * The JS function creating an 'fs.Stats' object
 */
extern uintptr_t g_statsConFn;

void fsReqCleanup (StackFrame * caller, js::NativeObject * o);
void fsCompletionCallback (uv_fs_t * req);
TaggedValue fsMakeStats (StackFrame * caller, uv_fs_t * req);
TaggedValue fsMakeReaddirArray (StackFrame * caller, uv_fs_t * req);

};

#endif //JSCOMP_FS_H
