// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include <assert.h>
#include "jsc/runtime.h"

namespace js
{

TaggedValue operator_ADD (StackFrame * caller, TaggedValue a, TaggedValue b)
{
    // TODO: we can speed this up significantly by dispatching on the combination of types
    //switch ((a.tag << 2) + b.tag) {

    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":operator_ADD", __LINE__);
    frame.locals[0] = toPrimitive(&frame, a);
    frame.locals[1] = toPrimitive(&frame, b);

    if (frame.locals[0].tag == VT_STRINGPRIM || frame.locals[1].tag == VT_STRINGPRIM) {
        frame.locals[0] = toString(&frame, frame.locals[0]);
        frame.locals[1] = toString(&frame, frame.locals[1]);
        return concatString(&frame, frame.locals[0].raw.sval, frame.locals[1].raw.sval);
    } else {
        return makeNumberValue(toNumber(&frame, frame.locals[0]) + toNumber(&frame, frame.locals[1]));
    }
}

TaggedValue operator_IN (TaggedValue a, TaggedValue b);
TaggedValue operator_INSTANCEOF (TaggedValue a, TaggedValue b);

const StringPrim * operator_TYPEOF (StackFrame * caller, TaggedValue a)
{
    switch (a.tag) {
        case VT_UNDEFINED: return JS_GET_RUNTIME(caller)->permStrUndefined;
        case VT_NULL:      return JS_GET_RUNTIME(caller)->permStrObject;
        case VT_BOOLEAN:   return JS_GET_RUNTIME(caller)->permStrBoolean;
        case VT_NUMBER:    return JS_GET_RUNTIME(caller)->permStrNumber;
        case VT_STRINGPRIM:return JS_GET_RUNTIME(caller)->permStrString;
        case VT_OBJECT:    return JS_GET_RUNTIME(caller)->permStrObject;
        case VT_FUNCTION:  return JS_GET_RUNTIME(caller)->permStrFunction;
        default:
            assert(false);
            return JS_GET_RUNTIME(caller)->permStrEmpty;
    }
}

TaggedValue operator_DELETE (TaggedValue a);

bool operator_IF_TRUE (TaggedValue a);

bool operator_IF_STRICT_EQ (TaggedValue a, TaggedValue b)
{
    if (a.tag != b.tag)
        return false;
    switch (a.tag) {
        case VT_UNDEFINED:
        case VT_NULL: return true;
        case VT_BOOLEAN: return a.raw.bval == b.raw.bval;
        case VT_NUMBER: return a.raw.nval == b.raw.nval;
        case VT_STRINGPRIM: return equal(a.raw.sval, b.raw.sval);
        default: return a.raw.mval == b.raw.mval;
    }
}

bool operator_IF_LOOSE_EQ (StackFrame * caller, TaggedValue a, TaggedValue b)
{
tailcall:
    if (a.tag == b.tag)
        return operator_IF_STRICT_EQ(a, b);

#define C(a,b) (((a) << _VT_SHIFT) + (b))
    switch (C(a.tag, b.tag)) {
        case C(VT_NULL, VT_UNDEFINED):
        case C(VT_UNDEFINED, VT_NULL):
            return true;
        case C(VT_NUMBER, VT_STRINGPRIM):
            return a.raw.nval == toNumber(caller, b);
        case C(VT_STRINGPRIM, VT_NUMBER):
            return toNumber(caller, a) == b.raw.nval;

        case C(VT_STRINGPRIM, VT_OBJECT):
        case C(VT_NUMBER, VT_OBJECT):
        case C(VT_STRINGPRIM, VT_FUNCTION):
        case C(VT_NUMBER, VT_FUNCTION):
            b = toPrimitive(caller, b);
            goto tailcall;
        case C(VT_OBJECT, VT_STRINGPRIM):
        case C(VT_OBJECT, VT_NUMBER):
        case C(VT_FUNCTION, VT_STRINGPRIM):
        case C(VT_FUNCTION, VT_NUMBER):
            a = toPrimitive(caller, a);
            goto tailcall;
    }
#undef C
    if (a.tag == VT_BOOLEAN) {
        a = makeNumberValue(a.raw.bval);
        goto tailcall;
    }
    if (b.tag == VT_BOOLEAN) {
        b = makeNumberValue(b.raw.bval);
        goto tailcall;
    }

    return false;
}

#define MAKE_IF_REL(NAME, LESS, CMP) \
    bool operator_IF_ ## NAME (StackFrame * caller, TaggedValue x, TaggedValue y)\
    {\
        StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":operator_IF_" #NAME, __LINE__);\
        frame.locals[0] = toPrimitive(&frame, x);\
        frame.locals[1] = toPrimitive(&frame, y);\
        if (frame.locals[0].tag == VT_STRINGPRIM && frame.locals[1].tag == VT_STRINGPRIM)\
            return LESS;\
        else\
            return primToNumber(frame.locals[0]) CMP primToNumber(frame.locals[1]);\
    }

MAKE_IF_REL(LT, less(frame.locals[0].raw.sval, frame.locals[1].raw.sval), <);
MAKE_IF_REL(LE, !less(frame.locals[1].raw.sval, frame.locals[0].raw.sval), <=);
MAKE_IF_REL(GT, less(frame.locals[1].raw.sval, frame.locals[0].raw.sval), >);
MAKE_IF_REL(GE, !less(frame.locals[0].raw.sval, frame.locals[1].raw.sval), >=);

#undef MAKE_IF_REL

}; // namespace js
