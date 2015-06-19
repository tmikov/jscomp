// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/runtime.h"

static js::TaggedValue fn1 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
    // add ( a, b )
    js::StackFrameN<1, 3, 2> frame(caller, env, __FILE__ ":add", __LINE__);
    // Optionally copy the arguments (ones which we don't modify can be accessed directly)
    // Here we copy them for illustration purposes
    frame.locals[0] = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    frame.locals[1] = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;

    // Store 'this' in the escaped environment, just for illustration
    frame.escaped->vars[0] = frame.locals[0];

    // return a + b
    frame.setLine(__LINE__ + 1);
    frame.locals[2] = js::operator_ADD(&frame, frame.locals[0], frame.locals[1]);
    return frame.locals[2];
}

js::TaggedValue module (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
    js::StackFrameN<1, 4, 1> frame(caller, env, __FILE__ ":module", __LINE__);
    frame.locals[0] = argv[0]; // "this" is always passed

    frame.escaped->vars[0] = js::newFunction(caller, env, JS_GET_RUNTIME(&frame)->internString(&frame, "add"), 2, fn1);

    // add( 10, 20 )
    frame.locals[1] = frame.locals[0];
    frame.locals[2] = js::makeNumberValue(10);
    frame.locals[3] = js::makeNumberValue(20);
    frame.setLine(__LINE__ + 1);
    return js::callFunction(&frame, frame.escaped->vars[0], 3, frame.locals + 1);
}

//int main (void)
//{
//    js::Runtime * runtime = new js::Runtime();
//    js::StackFrameN<0, 1, 0> frame(runtime, NULL, NULL, __FILE__ ":main", __LINE__);
//
//    frame.locals[0] = js::makeObjectValue(new(&frame) js::Object(runtime->objectPrototype));
//    frame.setLine(__LINE__ + 1);
//    module(&frame, runtime->env, 1, frame.locals);
//
//    js::forceGC(&frame);
//    js::forceGC(&frame);
//
//    return 0;
//}
