// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_JSNI_H
#define JSCOMP_JSNI_H

#ifndef JSCOMP_RUNTIME_H
#include "jsc/jsruntime.h"
#endif

namespace js {

template <class T>
T * safeObjectCast(StackFrame * caller, const TaggedValue & tv, const char * err = NULL)
{
    T * res;
    if (js::isValueTagObject(tv.tag) && (res = dynamic_cast<T *>(tv.raw.oval)) != NULL) {
        return res;
    } else {
        throwTypeError(caller, err ? err : "invalid object type");
        return NULL;
    }
}

#define JSNI_TRY(pframe, localIndex)\
    do{\
        js::StackFrame * const _pframe = (pframe); \
        unsigned const _localIndex = (localIndex); \
        js::TryRecord tryRec;\
        JS_GET_RUNTIME(_pframe)->pushTry(&tryRec);\
        if (::setjmp(tryRec.jbuf) == 0) {

#define JSNI_FINALLY(code) \
            JS_GET_RUNTIME(_pframe)->popTry(&tryRec); \
            code; \
        } else {\
            JS_GET_RUNTIME(_pframe)->popTry(&tryRec); \
            _pframe->locals[_localIndex] = JS_GET_RUNTIME(_pframe)->thrownObject; \
            code; \
            js::throwValue(_pframe, _pframe->locals[_localIndex]);\
        } \
    } while (0);


#define JSNI_WRAP_CALLBACK_BEGIN(name, localsCount) \
    do {\
        js::StackFrameN<0,localsCount+1,0> frame(JS_GET_TOPFRAME(), NULL, __FILE__ "::" name, __LINE__);\
        JSNI_TRY(&frame, localsCount)


#define JSNI_WRAP_CALLBACK_END(finallyCode) \
        JSNI_FINALLY( { finallyCode; JS_SET_TOPFRAME(frame.caller); } );\
    } while(0)

inline uintptr_t jsniMakeObjectHandle (StackFrame * caller, Object * o)
{
    return JS_GET_RUNTIME(caller)->handles.newHandle(caller, o);
}

inline uintptr_t jsniMakeObjectHandle (StackFrame * caller, TaggedValue v)
{
    if (!js::isValueTagObject(v.tag))
        throwTypeError(caller, "not an object");
    return jsniMakeObjectHandle(caller, v.raw.oval);
}

inline Object * jsniFromObjectHandle (StackFrame * caller, uintptr_t hnd)
{
    return (Object *)JS_GET_RUNTIME(caller)->handles.handle((unsigned)hnd);
}

inline void jsniDestroyObjectHandle (StackFrame * caller, uintptr_t hnd)
{
    JS_GET_RUNTIME(caller)->handles.destroyHandle((unsigned)hnd);
}

/**
 * argc and argv must include a slot fot the 'this' pointer, which will be populated by the function
 */
TaggedValue jsniNewObject (StackFrame * caller, TaggedValue constructor, unsigned argc, TaggedValue * argv);

}; // namespace js:wa

#endif //JSCOMP_JSNI_H
