// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include <uv.h>
#include "jsc/fs.h"
#include "jsc/jsni.h"

namespace js {

uintptr_t g_statsConFn = 0;

void fsReqCleanup (StackFrame * caller, js::NativeObject * o)
{
    uv_fs_t * req = (uv_fs_t *)o->getInternalUnsafe(0);
    if (req) {
        js::jsniDestroyObjectHandle(caller, (uintptr_t)req->data);
        uv_fs_req_cleanup(req);
        ::free(req);
        o->setInternalUnsafe(0, 0);
    }
    js::jsniDestroyObjectHandle(caller, o->getInternalUnsafe(1)); // the callback
    o->setInternalUnsafe(1, 0);
}

static inline double uvTimespec2Ms (const uv_timespec_t * ts)
{
    return ts->tv_sec * 1000.0 + ts->tv_nsec/1e6;
}

TaggedValue fsMakeStats (StackFrame * caller, uv_fs_t * req)
{
    StackFrameN<0,16,0> frame(caller, NULL, __FILE__ "::fsMakeStats()", __LINE__);
    frame.locals[0] = js::makeObjectValue(js::jsniFromObjectHandle(&frame, g_statsConFn));

    frame.locals[1] = JS_UNDEFINED_VALUE; // this
    frame.locals[2] = js::makeNumberValue(req->statbuf.st_dev);
    frame.locals[3] = js::makeNumberValue(req->statbuf.st_mode);
    frame.locals[4] = js::makeNumberValue(req->statbuf.st_nlink);
    frame.locals[5] = js::makeNumberValue(req->statbuf.st_uid);
    frame.locals[6] = js::makeNumberValue(req->statbuf.st_gid);
    frame.locals[7] = js::makeNumberValue(req->statbuf.st_rdev);
    frame.locals[8] = js::makeNumberValue(req->statbuf.st_blksize);
    frame.locals[9] = js::makeNumberValue(req->statbuf.st_ino);
    frame.locals[10] = js::makeNumberValue(req->statbuf.st_size);
    frame.locals[11] = js::makeNumberValue(req->statbuf.st_blocks);
    frame.locals[12] = js::makeNumberValue(uvTimespec2Ms(&req->statbuf.st_atim));
    frame.locals[13] = js::makeNumberValue(uvTimespec2Ms(&req->statbuf.st_mtim));
    frame.locals[14] = js::makeNumberValue(uvTimespec2Ms(&req->statbuf.st_ctim));
    frame.locals[15] = js::makeNumberValue(uvTimespec2Ms(&req->statbuf.st_birthtim));
    return js::jsniNewObject(&frame, frame.locals[0], 15, &frame.locals[1]);
}

TaggedValue fsMakeReaddirArray (StackFrame * caller, uv_fs_t * req)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ "::fsMakeReaddirArray()", __LINE__);
    frame.locals[0] = js::makeObjectValue(JS_GET_RUNTIME(&frame)->arrayPrototype->createDescendant(&frame));

    if (req->result <= 0)
        return frame.locals[0];

    uint32_t count = (uint32_t)req->result;
    ((Array *)frame.locals[0].raw.oval)->setLength(count);

    uint32_t i;
    for ( i = 0; i < count; ++i ) {
        uv_dirent_t ent;
        if (uv_fs_scandir_next(req, &ent) == UV_EOF)
            break;
        ((Array *)frame.locals[0].raw.oval)->elems[i] = js::makeStringValueFromUnvalidated(&frame, ent.name);
    }

    if (i != count) // Not sure if this could happen, but just in case
        ((Array *)frame.locals[0].raw.oval)->setLength(i);

    return frame.locals[0];
}

void fsCompletionCallback (uv_fs_t * req)
{
    js::NativeObject * o = NULL;

    JSNI_WRAP_CALLBACK_BEGIN("fsCompletionCallback", 5)
    {
        o = (js::NativeObject *)js::jsniFromObjectHandle(&frame, (uintptr_t)req->data);
        js::Function * cbwrap = (js::Function *)js::jsniFromObjectHandle(&frame, o->getInternalUnsafe(1));
        unsigned argc = 5;

        frame.locals[0] = JS_UNDEFINED_VALUE;
        frame.locals[1] = js::makeObjectValue(o);
        frame.locals[2] = js::makeNumberValue(req->fs_type);
        frame.locals[3] = js::makeNumberValue(req->result);

        switch (req->fs_type) {
            case UV_FS_STAT:
            case UV_FS_LSTAT:
            case UV_FS_FSTAT:
                frame.locals[4] = fsMakeStats(&frame, req);
                break;

            case UV_FS_SCANDIR:
                frame.locals[4] = fsMakeReaddirArray(&frame, req);
                break;

            default:
                frame.locals[4] = frame.locals[3]; // req->result
                break;
        }

        cbwrap->call(&frame, argc, &frame.locals[0]);
    }
    JSNI_WRAP_CALLBACK_END({
        fsReqCleanup(&frame, o);
    });
}

}; // namespace js
