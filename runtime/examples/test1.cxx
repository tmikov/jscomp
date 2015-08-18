#include <jsc/jsruntime.h>
#include <stdio.h>

static const js::StringPrim * s_strings[5];
static const char s_strconst[] =
  "printfact2fact3inner";
static const unsigned s_strofs[10] = {0,5,5,4,5,5,10,5,15,5};

static js::TaggedValue fn1 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // <unnamed>
static js::TaggedValue fn2 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // print
static js::TaggedValue fn3 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // fact
static js::TaggedValue fn4 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // fact2
static js::TaggedValue fn5 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // fact3
static js::TaggedValue fn6 (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // inner


// <unnamed>
static js::TaggedValue fn1 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<1,7,0> frame(caller, env, __FILE__ ":<unnamed>", __LINE__);

B0:
  frame.setLine(__LINE__+1);
  frame.locals[3] = js::newFunction(&frame, frame.escaped, s_strings[0]/*"print"*/, 1, fn2);
  frame.setLine(__LINE__+1);
  frame.escaped->vars[0] = js::newFunction(&frame, frame.escaped, s_strings[1]/*"fact"*/, 1, fn3);
  frame.setLine(__LINE__+1);
  frame.locals[4] = js::newFunction(&frame, frame.escaped, s_strings[2]/*"fact2"*/, 1, fn4);
  frame.setLine(__LINE__+1);
  frame.locals[5] = js::newFunction(&frame, frame.escaped, s_strings[3]/*"fact3"*/, 1, fn5);
  frame.locals[6] = js::makeNumberValue(0);
  frame.locals[6] = js::makeNumberValue(js::toNumber(&frame, frame.locals[6]) + 1);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeStringValue(s_strings[1]/*"fact"*/);
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeNumberValue(100);
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn3(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = frame.locals[0];
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeStringValue(s_strings[2]/*"fact2"*/);
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeNumberValue(100);
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn4(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = frame.locals[0];
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeStringValue(s_strings[3]/*"fact3"*/);
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeNumberValue(100);
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn5(&frame, frame.escaped, 2, &frame.locals[1]);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = frame.locals[0];
  frame.setLine(__LINE__+1);
  fn2(&frame, frame.escaped, 2, &frame.locals[1]);
  return JS_UNDEFINED_VALUE;
B1:
  ;
}

// print
static js::TaggedValue fn2 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<0,1,1> frame(caller, env, __FILE__ ":print", __LINE__);

B0:
  frame.locals[0] = (argc > 1 ? argv[1] : JS_UNDEFINED_VALUE);
{(frame.locals[0]) = js::toString(&frame, (frame.locals[0]));
printf("%s\n", (frame.locals[0]).raw.sval->getStr());;}
  return JS_UNDEFINED_VALUE;
B1:
  ;
}

// fact
static js::TaggedValue fn3 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<0,4,1> frame(caller, env, __FILE__ ":fact", __LINE__);

B0:
  frame.locals[3] = (argc > 1 ? argv[1] : JS_UNDEFINED_VALUE);
  if (!operator_IF_LE(&frame, frame.locals[3], js::makeNumberValue(2))) goto B3;
B1:
  return frame.locals[3];
B3:
  frame.locals[0] = js::makeNumberValue(js::toNumber(&frame, frame.locals[3]) - 1);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = frame.locals[0];
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn3(&frame, env, 2, &frame.locals[1]);
  frame.locals[0] = js::makeNumberValue(js::toNumber(&frame, frame.locals[0]) * js::toNumber(&frame, frame.locals[3]));
  return frame.locals[0];
B5:
  ;
}

// fact2
static js::TaggedValue fn4 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<0,2,1> frame(caller, env, __FILE__ ":fact2", __LINE__);

B0:
  frame.locals[0] = (argc > 1 ? argv[1] : JS_UNDEFINED_VALUE);
  frame.locals[1] = frame.locals[0];
B1:
  frame.locals[0] = js::makeNumberValue(js::toNumber(&frame, frame.locals[0]) - 1);
  if (!operator_IF_GT(&frame, frame.locals[0], js::makeNumberValue(1))) goto B3;
B2:
  frame.locals[1] = js::makeNumberValue(js::toNumber(&frame, frame.locals[1]) * js::toNumber(&frame, frame.locals[0]));
  goto B1;
B3:
  return frame.locals[1];
B4:
  ;
}

// fact3
static js::TaggedValue fn5 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<1,5,1> frame(caller, env, __FILE__ ":fact3", __LINE__);

B0:
  frame.locals[4] = (argc > 1 ? argv[1] : JS_UNDEFINED_VALUE);
  frame.setLine(__LINE__+1);
  frame.escaped->vars[0] = js::newFunction(&frame, frame.escaped, s_strings[4]/*"inner"*/, 2, fn6);
  frame.locals[1] = JS_UNDEFINED_VALUE;
  frame.locals[2] = js::makeNumberValue(1);
  frame.locals[3] = frame.locals[4];
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn6(&frame, frame.escaped, 3, &frame.locals[1]);
  return frame.locals[0];
B1:
  ;
}

// inner
static js::TaggedValue fn6 (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)
{
  js::StackFrameN<0,7,2> frame(caller, env, __FILE__ ":inner", __LINE__);

B0:
  frame.locals[5] = (argc > 1 ? argv[1] : JS_UNDEFINED_VALUE);
  frame.locals[6] = (argc > 2 ? argv[2] : JS_UNDEFINED_VALUE);
  if (!operator_IF_LT(&frame, frame.locals[6], js::makeNumberValue(2))) goto B3;
B1:
  return frame.locals[5];
B3:
  frame.locals[0] = js::makeNumberValue(js::toNumber(&frame, frame.locals[5]) * js::toNumber(&frame, frame.locals[6]));
  frame.locals[1] = js::makeNumberValue(js::toNumber(&frame, frame.locals[6]) - 1);
  frame.locals[2] = JS_UNDEFINED_VALUE;
  frame.locals[3] = frame.locals[0];
  frame.locals[4] = frame.locals[1];
  frame.setLine(__LINE__+1);
  frame.locals[0] = fn6(&frame, env, 3, &frame.locals[2]);
  return frame.locals[0];
B5:
  ;
}

int main()
{
    js::g_runtime = new js::Runtime();
    js::StackFrameN<0, 1, 0> frame(NULL, NULL, __FILE__ ":main", __LINE__);
    JS_GET_RUNTIME(&frame)->initStrings(&frame, s_strings, s_strconst, s_strofs, 5);
    frame.setLine(__LINE__+1);
    frame.locals[0] = js::makeObjectValue(new(&frame) js::Object(JS_GET_RUNTIME(&frame)->objectPrototype));
    frame.setLine(__LINE__+1);
    fn1(&frame, JS_GET_RUNTIME(&frame)->env, 1, frame.locals);

    if (JS_GET_RUNTIME(&frame)->diagFlags & (js::Runtime::DIAG_HEAP_GC | js::Runtime::DIAG_FORCE_GC))
        js::forceGC(&frame);

    return 0;
}
