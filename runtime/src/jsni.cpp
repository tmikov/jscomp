// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsni.h"

namespace js {

TaggedValue jsniNewObject (StackFrame * caller, TaggedValue constructor, unsigned argc, TaggedValue * argv)
{
    argv[0] = js::get(caller, constructor, JS_GET_RUNTIME(caller)->permStrPrototype);
    if (!js::isValueTagObject(argv[0].tag))
        argv[0] = js::makeObjectValue(JS_GET_RUNTIME(caller)->objectPrototype);
    argv[0] = js::makeObjectValue(js::objectCreate(caller, argv[0]));
    TaggedValue res = js::callCons(caller, constructor, argc, argv);
    if (res.tag != VT_UNDEFINED)
        argv[0] = res;
    return argv[0];
}

}; // namespace js
