// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/runtime.h"

#include <assert.h>
#include <stdarg.h>
#include <errno.h>

// Need our own definition to avoid warnings when using it on C++ objects
#define OFFSETOF(type, field)  ((char*)&(((type*)0)->field) - ((char*)0) )

namespace js
{

Runtime * g_runtime = NULL;

void Memory::finalizer ()
{ }

Memory::~Memory ()
{ }

bool Env::mark (IMark * marker, unsigned markBit) const
{
    if (!markMemory(marker, markBit, parent))
        return false;
    for (auto * p = vars, * e = vars + size; p < e; ++p)
        if (!markValue(marker, markBit, *p))
            return false;
    return true;
}

Env * Env::make (StackFrame * caller, Env * parent, unsigned size)
{
    Env * env = new(caller, OFFSETOF(Env, vars) + sizeof(((Env *)0)->vars[0]) * size) Env();

    env->parent = parent;
    env->size = size;
    memset(env->vars, 0, size * sizeof(env->vars[0]));
    return env;
}


TaggedValue * Env::var (unsigned level, unsigned index)
{
    Env * penv = this;
    while (level-- != 0)
        penv = penv->parent;
    return &penv->vars[index];
}

bool Object::mark (IMark * marker, unsigned markBit) const
{
    if (!markMemory(marker, markBit, parent))
        return false;
    for (const auto & it : props)
        if (!markMemory(marker, markBit, it.second.name) || !markValue(marker, markBit, it.second.value))
            return false;
    return true;
}

Object * Object::defineOwnProperty (StackFrame * caller, const StringPrim * name, unsigned flags, TaggedValue value,
                                    Function * get, Function * set
)
{
    if (flags & PROP_GET_SET)
        value = makeMemoryValue(VT_MEMORY, new(caller) PropertyAccessor(get, set));

    auto it = props.find(name->getStr());
    if (it != props.end()) {
        if (!(it->second.flags & PROP_CONFIGURABLE))
            throwTypeError(caller, "Cannot redefine property '%s'", name->getStr());

        Property * prop = &it->second;
        prop->flags = flags;
        prop->value = value;
    } else {
        props.emplace(std::piecewise_construct, std::make_tuple(name->getStr()), std::make_tuple(name, flags, value));
    }

    return this;
}

Property * Object::getProperty (const char * name)
{
    Object * cur = this;
    do {
        if (Property * p = cur->getOwnProperty(name))
            return p;
    } while ((cur = this->parent) != NULL);
    return NULL;
}

TaggedValue Object::get (StackFrame * caller, const char * name)
{
    if (Property * p = getProperty(name)) {
        if ((p->flags & PROP_GET_SET) == 0) {
            return p->value;
        } else {
            // Invoke the getter
            if (Function * getter = ((PropertyAccessor *)p->value.raw.oval)->get) {
                TaggedValue thisp = makeObjectValue(this);
                return (*getter->code)(caller, getter->env, 1, &thisp);
            }
        }
    }
    return JS_UNDEFINED_VALUE;
}

void Object::put (StackFrame * caller, const StringPrim * name, TaggedValue v)
{
    Object * cur = this;
    do {
        if (Property * p = cur->getOwnProperty(name->getStr())) {
            if ((cur->flags & OF_NOWRITE) || !(p->flags & PROP_WRITEABLE)) {
                goto cannotWrite;
            }
            if (!(p->flags & PROP_GET_SET)) {
                p->value = v;
                return;
            } else {
                if (Function * setter = ((PropertyAccessor *)p->value.raw.oval)->set) {
                    // Note: we don't need to create a frame for this because both parameters must be accessible
                    // via different means
                    if (true) {
                        TaggedValue args[2] = {makeObjectValue(this), v};
                        (*setter->code)(caller, setter->env, 2, args);
                    } else {
                        StackFrameN<0, 2, 2> frame(caller, NULL, __FILE__ ":put", __LINE__ + 3);
                        frame.locals[0] = makeObjectValue(this);
                        frame.locals[1] = v;
                        (*setter->code)(&frame, setter->env, 2, frame.locals);
                    }
                    return;
                } else {
                    goto cannotWrite;
                }
            }
        }
    } while ((cur = this->parent) != NULL);

    if (this->flags & OF_NOEXTEND)
        goto cannotWrite;

    this->props.emplace(std::piecewise_construct, std::make_tuple(name->getStr()),
                        std::make_tuple(name, PROP_WRITEABLE|PROP_ENUMERABLE|PROP_CONFIGURABLE, v));
    return;

cannotWrite:;
    if (JS_IS_STRICT_MODE(caller))
        throwTypeError(caller, "Property '%s' is not writable", name->getStr());
}

TaggedValue Object::getComputed (StackFrame * caller, TaggedValue propName)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return this->get(&frame, frame.locals[0].raw.sval->getStr());
}

void Object::putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::putComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    this->put(&frame, frame.locals[0].raw.sval, v);
}

bool Object::deleteProperty (StackFrame * caller, const char * name)
{
    auto it = props.find(name);
    if (it != props.end()) {
        if (!(it->second.flags & PROP_CONFIGURABLE)) {
            if (JS_IS_STRICT_MODE(caller))
                throwTypeError(caller, "Property '%s' is not deletable", name);
            return false;
        }
        props.erase(it);
    }
    return true;
}

TaggedValue Object::defaultValue (StackFrame * caller, ValueTag preferredType)
{
    if (!preferredType) {
        // FIXME: When the [[DefaultValue]] internal method of O is called with no hint, then it behaves as if the hint
        // FIXME: were Number, unless O is a Date object (see 15.9.6), in which case it behaves as if the hint were String.
        preferredType = VT_NUMBER;
    }

    StackFrameN<0,2,1> frame(caller, NULL, __FILE__ ":defaultValue", __LINE__);
    frame.locals[1] = makeObjectValue(this);

    TaggedValue tmp;

    if (preferredType == VT_STRINGPRIM)
        goto preferString;
    else
        goto preferNumber;

preferString:
    frame.locals[0] = get(&frame, "toString");
    if (js::isCallable(frame.locals[0])) {
        tmp = frame.locals[0].raw.oval->call(&frame, 1, &frame.locals[1]);
        if (isValueTagPrimitive((ValueTag)tmp.tag))
            return tmp;
    }
    if (preferredType == VT_NUMBER)
        goto error;

preferNumber:
    frame.locals[0] = get(&frame, "valueOf");
    if (js::isCallable(frame.locals[0])) {
        tmp = frame.locals[0].raw.oval->call(&frame, 1, &frame.locals[1]);
        if (isValueTagPrimitive((ValueTag)tmp.tag))
            return tmp;
    }
    if (preferredType == VT_NUMBER)
        goto preferString;

error:
    throwTypeError(&frame, "Cannot determine default value");
}

bool Object::isCallable () const
{
    return false;
}

TaggedValue Object::call (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    throwTypeError(caller, "not a function");
}

bool PropertyAccessor::mark (IMark * marker, unsigned markBit) const
{
    return markMemory(marker, markBit, get) && markMemory(marker, markBit, set);
}

bool Array::mark (IMark * marker, unsigned markBit) const
{
    if (!Object::mark(marker, markBit))
        return false;
    for (const auto & value : elems)
        if (!markValue(marker, markBit, value))
            return false;
    return true;
}

void Array::setLength (unsigned newLen)
{
    elems.resize(newLen, TaggedValue{VT_UNDEFINED});
}

void Array::setElem (unsigned index, TaggedValue v)
{
    if (index >= elems.size())
        setLength(index + 1);
    elems[index] = v;
}

int32_t Array::isIndexString (const char * str)
{
    if (str[0] >= '0' && str[0] <= '9') { // Filter out the obvious cases
        char * end;
        errno = 0;
        unsigned long ul = strtoul(str, &end, 10);
        if (errno == 0 && *end == 0 && ul <= INT32_MAX)
            return (int32_t)ul;
    }
    return -1;
}

TaggedValue Array::getComputed (StackFrame * caller, TaggedValue propName)
{
    int32_t index;
    // Fast path
    if ((index = isNonNegativeInteger(propName)) >= 0)
        return getElem(index);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    if ((index = isIndexString(frame.locals[0].raw.sval->getStr())) >= 0)
        return getElem(index);

    return this->get(&frame, frame.locals[0].raw.sval->getStr());
}

void Array::putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v)
{
    int32_t index;
    // Fast path
    if ((index = isNonNegativeInteger(propName)) >= 0) {
        setElem(index, v);
        return;
    }

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    if ((index = isIndexString(frame.locals[0].raw.sval->getStr())) >= 0) {
        setElem(index, v);
        return;
    }

    this->put(&frame, frame.locals[0].raw.sval, v);
}

Function::Function (Object * parent, Env * env, CodePtr code) :
    Object(parent), prototype(NULL), env(env), length(0), code(code)
{
}

void Function::init (StackFrame * caller, const StringPrim * name, unsigned length)
{
    Runtime * r = JS_GET_RUNTIME(caller);
    if (!name)
        name = r->permStrEmpty;
    this->length = length;
    defineOwnProperty(caller, r->permStrLength, 0, makeNumberValue(length));
    defineOwnProperty(caller, r->permStrName, 0, makeStringValue(name));
    defineOwnProperty(caller, r->permStrArguments, 0, JS_NULL_VALUE);
    defineOwnProperty(caller, r->permStrCaller, 0, JS_NULL_VALUE);
}

bool Function::mark (IMark * marker, unsigned markBit) const
{
    return Object::mark(marker, markBit) && markMemory(marker, markBit, prototype) && markMemory(marker, markBit, env);
}

void Function::definePrototype (StackFrame * caller, Object * prototype)
{
    this->prototype = prototype;
    defineOwnProperty(caller, JS_GET_RUNTIME(caller)->permStrPrototype, 0, makeObjectValue(prototype));
}

bool Function::isCallable () const
{
    return true;
}

TaggedValue Function::call (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    return (*this->code)(caller, this->env, argc, argv);
}

bool StringPrim::mark (IMark * marker, unsigned markBit) const
{
    return true;
}

StringPrim * StringPrim::makeEmpty (StackFrame * caller, unsigned length)
{
    return new(caller, OFFSETOF(StringPrim, _str) + length + 1) StringPrim(length);
}

StringPrim * StringPrim::make (StackFrame * caller, const char * str, unsigned length)
{
    StringPrim * res = makeEmpty(caller, length);
    memcpy( res->_str, str, length);
    return res;
}

bool String::mark (IMark * marker, unsigned markBit) const
{
    return Object::mark(marker, markBit) && markMemory(marker, markBit, this->value.raw.mval);
}

TaggedValue String::defaultValue (StackFrame *, ValueTag)
{
    return this->value;
}

TaggedValue Number::defaultValue (StackFrame *, ValueTag)
{
    return this->value;
}

TaggedValue Boolean::defaultValue (StackFrame *, ValueTag)
{
    return this->value;
}

bool StackFrame::mark (IMark * marker, unsigned markBit) const
{
    if (!markMemory(marker, markBit, escaped))
        return false;
    for (auto * p = locals, * e = locals + localCount; p < e; ++p)
        if (!markValue(marker, markBit, *p))
            return false;
    return true;
}

void StackFrame::printStackTrace ()
{
    for (StackFrame * cur = this; cur; cur = cur->caller) {
#ifdef JS_DEBUG
        const char * lf = cur->getFileFunc();
        fprintf(stderr, "  %s[%u] frame %p\n", lf ? lf : "<unknown source>", cur->getLine(), cur);
#else
        fprintf( stderr, "  frame %p\n", cur );
#endif
    }
}

static TaggedValue emptyFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    return JS_UNDEFINED_VALUE;
}

static TaggedValue objectFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    // TODO: implement
    return JS_UNDEFINED_VALUE;
}

static TaggedValue functionFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    // TODO: implement
    return JS_UNDEFINED_VALUE;
}

static TaggedValue stringFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    // TODO: implement
    return JS_UNDEFINED_VALUE;
}

static TaggedValue numberFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    // TODO: implement
    return JS_UNDEFINED_VALUE;
}

static TaggedValue booleanFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    // TODO: implement
    return JS_UNDEFINED_VALUE;
}

bool Runtime::MemoryHead::mark (IMark *, unsigned) const
{ return true; }


Runtime::Runtime (bool strictMode)
{
    diagFlags = 0;
    this->strictMode = strictMode;
    env = NULL;
    markBit = 0;
    head.header = 0;
    tail = &head;
    allocatedSize = 0;
    gcThreshold = 100;

    g_runtime = this;
    parseDiagEnvironment();

    // Note: we need to be extra careful to store allocated values where the FC can trace them.
    StackFrameN<0, 5, 0> frame(NULL, NULL, __FILE__ ":Runtime::Runtime()", __LINE__);

    // Perm strings
    permStrEmpty = internString(&frame, "");
    permStrUndefined = internString(&frame, "undefined");
    permStrNull = internString(&frame, "null");
    permStrTrue = internString(&frame, "true");
    permStrFalse = internString(&frame, "false");
    permStrNaN = internString(&frame, "NaN");
    permStrPrototype = internString(&frame, "prototype");
    permStrConstructor = internString(&frame, "constructor");
    permStrLength = internString(&frame, "length");
    permStrName = internString(&frame, "name");
    permStrArguments = internString(&frame, "arguments");
    permStrCaller = internString(&frame, "caller");

    // Global env
    env = Env::make(&frame, NULL, 10);

    objectPrototype = new(&frame) Object(NULL);
    frame.locals[0] = makeObjectValue(objectPrototype);
    // TODO: 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    // TODO: '__defineGetter__', '__lookupGetter__', '__defineSetter__', '__lookupSetter__', '__proto__'

    functionPrototype = new(&frame) Function(objectPrototype, env, emptyFunc);
    frame.locals[1] = makeObjectValue(functionPrototype);
    functionPrototype->init(&frame, internString(&frame,"functionPrototype"), 0);
    // TODO: in functionPrototype define bind, toString, call, apply

    object = new(&frame) Function(functionPrototype, env, objectFunc);
    env->vars[0] = makeObjectValue(object);
    object->init(&frame, internString(&frame,"Object"), 1);
    // TODO: keys, create, defineOwnProperty, defineProperties, freeze, getPrototypeOf, setPrototypeOf,
    // TODO: getOwnPropertyDescriptor(), getOwnPropertyNames(), is, isExtensible, isFrozen, isSealed, preventExtensions,
    // TODO: seal, getOwnPropertySymbols, deliverChangeRecords, getNotifier, observe, unobserve
    // TODO: arity? (from spidermonkey)
    object->definePrototype(&frame, objectPrototype);

    function = new(&frame) Function(functionPrototype, env, functionFunc);
    env->vars[1] = makeObjectValue(function);
    function->init(&frame, internString(&frame,"Function"), 1);
    function->definePrototype(&frame, functionPrototype);

    objectPrototype->defineOwnProperty(
        &frame, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(object));
    functionPrototype->defineOwnProperty(
        &frame, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(function));

    // String
    //
    stringPrototype = new(&frame) Object(objectPrototype);
    frame.locals[2] = makeObjectValue(stringPrototype);

    string = new(&frame) Function(functionPrototype, env, stringFunc);
    env->vars[2] = makeObjectValue(string);
    string->init(&frame, internString(&frame,"String"), 1);
    string->definePrototype(&frame, stringPrototype);

    stringPrototype->defineOwnProperty(
        &frame, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(string));

    // Number
    //
    numberPrototype = new(&frame) Object(objectPrototype);
    frame.locals[3] = makeObjectValue(numberPrototype);

    number = new(&frame) Function(functionPrototype, env, numberFunc);
    env->vars[3] = makeObjectValue(number);
    number->init(&frame, internString(&frame,"Number"), 1);
    number->definePrototype(&frame, numberPrototype);

    numberPrototype->defineOwnProperty(
        &frame, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(number));

    // Boolean
    //
    booleanPrototype = new(&frame) Object(objectPrototype);
    frame.locals[4] = makeObjectValue(booleanPrototype);

    boolean = new(&frame) Function(functionPrototype, env, booleanFunc);
    env->vars[4] = makeObjectValue(boolean);
    boolean->init(&frame, internString(&frame,"Boolean"), 1);
    boolean->definePrototype(&frame, booleanPrototype);

    booleanPrototype->defineOwnProperty(
        &frame, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(boolean));

    // True and False objects
    env->vars[5] = makeObjectValue(trueObject = new (&frame) Boolean(booleanPrototype, makeBooleanValue(true)));
    env->vars[6] = makeObjectValue(falseObject = new (&frame) Boolean(booleanPrototype, makeBooleanValue(false)));
}

void Runtime::parseDiagEnvironment ()
{
    #define _E(x)  {#x, Runtime::DIAG_ ## x, NULL}
    static struct { const char * name; unsigned flag; const char * help; } s_envFlags[] = {
        _E(HEAP_ALLOC),
        _E(HEAP_ALLOC_STACK),
        _E(HEAP_GC),
        _E(HEAP_GC_VERBOSE),
        _E(ALL),
        _E(FORCE_GC),
    };
    #undef _E
    if (const char * s = ::getenv("JSC_DIAG"))
    {
        std::vector<char> buf(s, strchr(s,0)+1);
        static const char SEP[] = ",:; \t";

        for ( char *inp = buf.data(), *tok, *last; (tok = strtok_r(inp, SEP, &last)); inp = NULL ) {
            if (strcmp(tok, "HELP") == 0) {
                fprintf(stderr, "JSC_DIAG options:\n");
                for ( int i = 0; i < sizeof(s_envFlags)/sizeof(s_envFlags[0]); ++i ) {
                    fprintf(stderr, "  %s", s_envFlags[i].name);
                    if (s_envFlags[i].help)
                        fprintf(stderr, " - %s\n", s_envFlags[i].help);
                    fprintf(stderr, "\n");
                }
            }
            else {
                bool found = false;
                for ( int i = 0; i < sizeof(s_envFlags)/sizeof(s_envFlags[0]); ++i )
                    if (strcmp(tok, s_envFlags[i].name) == 0) {
                        this->diagFlags |= s_envFlags[i].flag;
                        found = true;
                        break;
                    }
                if (!found)
                    fprintf(stderr, "warning: unrecognized diag option '%s'\n", tok);
            }
        }
    }
}

bool Runtime::mark (IMark * marker, unsigned markBit)
{
    for ( auto it : this->permStrings )
        markMemory(marker, markBit, it.second);
    return markMemory(marker, markBit, env);
}

const StringPrim * Runtime::internString (StackFrame * caller, const char * str, unsigned len)
{
    StringPrim * res;
    auto it = permStrings.find(str);
    if (it == permStrings.end()) {
        res = StringPrim::make(caller, str, len);
        permStrings[res->getStr()] = res;
    } else {
        res = it->second;
    }
    return res;
}
const StringPrim * Runtime::internString (StackFrame * caller, const char * str)
{
    return internString(caller, str, (unsigned)strlen(str));
}

void Runtime::initStrings (
    StackFrame * caller, const StringPrim ** prims, const char * strconst, const unsigned * offsets, unsigned count
)
{
    for ( unsigned i = 0; i < count; ++i )
        prims[i] = internString(caller, strconst + offsets[i<<1], offsets[(i<<1)+1]);
}

TaggedValue newFunction (StackFrame * caller, Env * env, const StringPrim * name, unsigned length, CodePtr code)
{
    StackFrameN<0, 2, 0> frame(caller, env, __FILE__ ":newFunction", __LINE__);
    Function * func;
    frame.locals[0] = makeObjectValue(
        func = new(&frame) Function(JS_GET_RUNTIME(&frame)->functionPrototype, env, code));
    func->init(&frame, name, length);

    frame.locals[1] = makeObjectValue(new(&frame) Object(JS_GET_RUNTIME(&frame)->objectPrototype));
    frame.locals[1].raw.oval->defineOwnProperty(
        &frame, JS_GET_RUNTIME(caller)->permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, frame.locals[0]
    );

    func->definePrototype(&frame, frame.locals[1].raw.oval);

    return frame.locals[0];
}

void throwTypeError (StackFrame *, const char * msg, ...)
{
    char * buf;
    va_list ap;
    va_start(ap, msg);
    vasprintf(&buf, msg, ap);
    va_end(ap);
    // FIXME:
    if (buf)
        fprintf(stderr, "TypeError: %s\n", buf);
    free(buf);
    abort();
}

bool isCallable (TaggedValue v)
{
    return isValueTagObject((ValueTag)v.tag) && v.raw.oval->isCallable();
}

TaggedValue callFunction (StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv)
{
    if (isValueTagObject((ValueTag)value.tag))
        return value.raw.oval->call(caller, argc, argv);

    throwTypeError(caller, "not a function");
    return JS_UNDEFINED_VALUE;
};

void put (StackFrame * caller, TaggedValue obj, const StringPrim * propName, TaggedValue val)
{
    switch (obj.tag) {
        case VT_UNDEFINED: throwTypeError(caller, "cannot assign property '%s' of undefined", propName->getStr()); break;
        case VT_NULL:      throwTypeError(caller, "cannot assign property '%s' of null", propName->getStr()); break;

        case VT_OBJECT:
        case VT_FUNCTION: obj.raw.oval->put(caller, propName, val); break;

        case VT_NUMBER:
        case VT_BOOLEAN:
        case VT_STRINGPRIM:
            if (JS_IS_STRICT_MODE(caller))
                throwTypeError(caller, "cannot assign property '%s' of primitive", propName->getStr()); break;
            break;
        default:
            assert(false);
            break;
    }
}

void putComputed (StackFrame * caller, TaggedValue obj, TaggedValue propName, TaggedValue val)
{
    switch (obj.tag) {

        case VT_OBJECT:
        case VT_FUNCTION: obj.raw.oval->putComputed(caller, propName, val); break;

        case VT_NUMBER:
        case VT_BOOLEAN:
        case VT_STRINGPRIM:
            if (JS_IS_STRICT_MODE(caller)) {
        case VT_UNDEFINED:
        case VT_NULL:
                StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":putComputed", __LINE__);
                frame.locals[0] = toString(&frame, propName);
                throwTypeError(&frame, "cannot assign property '%s' of primitive", frame.locals[0].raw.sval->getStr());
            }
            break;
        default:
            assert(false);
            break;
    }
}

TaggedValue get (StackFrame * caller, TaggedValue obj, const StringPrim * propName)
{
    switch (obj.tag) {
        case VT_UNDEFINED: throwTypeError(caller, "cannot read property '%s' of undefined", propName->getStr()); break;
        case VT_NULL:      throwTypeError(caller, "cannot read property '%s' of null", propName->getStr()); break;

        case VT_OBJECT:
        case VT_FUNCTION: return obj.raw.oval->get(caller, propName->getStr()); break;

        case VT_NUMBER:
        case VT_BOOLEAN:
        case VT_STRINGPRIM: {
            // TODO: avoid temporary object creation
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":get", __LINE__);
            Object * o = toObject(&frame, obj);
            frame.locals[0] = makeObjectValue(o);
            return o->get(&frame, propName->getStr());
        }
        break;
        default:
            assert(false);
            break;
    }
    return JS_UNDEFINED_VALUE;
}

TaggedValue getComputed (StackFrame * caller, TaggedValue obj, TaggedValue propName)
{
    switch (obj.tag) {
        case VT_UNDEFINED:
        case VT_NULL: {
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":putComputed", __LINE__);
            frame.locals[0] = toString(&frame, propName);
            throwTypeError(&frame, "cannot read property '%s' of %s", frame.locals[0].raw.sval->getStr(),
                obj.tag == VT_UNDEFINED ? "undefined" : "null"
            );
        }
        break;

        case VT_OBJECT:
        case VT_FUNCTION: return obj.raw.oval->getComputed(caller, propName); break;

        case VT_NUMBER:
        case VT_BOOLEAN:
        case VT_STRINGPRIM: {
            // TODO: avoid temporary object creation
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":get", __LINE__);
            Object * o = toObject(&frame, obj);
            frame.locals[0] = makeObjectValue(o);
            return o->getComputed(&frame, propName);
        }
        break;
        default:
            assert(false);
            break;
    }
    return JS_UNDEFINED_VALUE;
}

Object * toObject (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:
        case VT_NULL:
            throwTypeError(caller, "Cannot be converted to an object");

        case VT_BOOLEAN:    return v.raw.bval ? JS_GET_RUNTIME(caller)->trueObject : JS_GET_RUNTIME(caller)->falseObject;
        case VT_NUMBER:     return new (caller) Number(JS_GET_RUNTIME(caller)->numberPrototype, v);
        case VT_STRINGPRIM: return new (caller) String(JS_GET_RUNTIME(caller)->stringPrototype, v);
        default:
            assert(isValueTagObject((ValueTag)v.tag));
            return v.raw.oval;
    }
}

TaggedValue toString (StackFrame * caller, double n)
{
    if (isnan(n))
        return makeStringValue(JS_GET_RUNTIME(caller)->permStrNaN);
    else {
        char buf[64];
        sprintf(buf, "%.16g", n);
        return makeStringValue(caller, buf);
    }
}

TaggedValue toString (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:  return makeStringValue(JS_GET_RUNTIME(caller)->permStrUndefined);
        case VT_NULL:       return makeStringValue(JS_GET_RUNTIME(caller)->permStrNull);
        case VT_BOOLEAN:    return makeStringValue(v.raw.bval ? JS_GET_RUNTIME(caller)->permStrTrue : JS_GET_RUNTIME(caller)->permStrFalse);
        case VT_NUMBER:     return toString(caller, v.raw.nval);
        case VT_STRINGPRIM: return v;
        case VT_OBJECT: {
            StackFrameN<0,1,1> frame(caller, NULL, __FILE__ ":toString", __LINE__);
            frame.locals[0] = toPrimitive(&frame, v, VT_STRINGPRIM);
            return toString(&frame, frame.locals[0]);
        }
        default:
            assert(false);
    };
}

TaggedValue toPrimitive (StackFrame * caller, TaggedValue v, ValueTag preferredType)
{
    switch (v.tag) {
        case VT_UNDEFINED:
        case VT_NULL:
        case VT_BOOLEAN:
        case VT_NUMBER:
        case VT_STRINGPRIM:
            return v;
        case VT_OBJECT:
            return v.raw.oval->defaultValue(caller, preferredType);
        default:
            assert(false);
    }
}

double toNumber (const StringPrim * str)
{
    const char * s = str->getStr();
    char * e;

    // strtod() not thread safe???
    // see http://stackoverflow.com/a/6527903/237223
    // need to use strtod_l() with a locale per thread
    double res = strtod(s, &e);

    // Skip trailing blanks
    while (isspace(*e))
        ++e;
    if (*e) // extra characters
        return NAN;

    return res;
}

double toNumber (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED: return NAN;
        case VT_NULL: return 0;
        case VT_BOOLEAN: return v.raw.bval;
        case VT_NUMBER: return v.raw.nval;
        case VT_STRINGPRIM: return toNumber(v.raw.sval);
        case VT_OBJECT: {
            StackFrameN<0,1,1> frame(caller, NULL, __FILE__ ":toNumber", __LINE__);
            frame.locals[0] = toPrimitive(&frame, v, VT_NUMBER);
            return toNumber(&frame, frame.locals[0]);
        }
        default:
            assert(false);
    };
}

double primToNumber (TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED: return NAN;
        case VT_NULL: return 0;
        case VT_BOOLEAN: return v.raw.bval;
        case VT_NUMBER: return v.raw.nval;
        case VT_STRINGPRIM: return toNumber(v.raw.sval);
        default:
            assert(false);
    };
}

int32_t toInt32 (StackFrame * caller, TaggedValue v)
{
    return toInt32(toNumber(caller, v));
}

TaggedValue concatString (StackFrame * caller, StringPrim * a, StringPrim * b)
{
    StringPrim * res = StringPrim::makeEmpty(caller, a->length + b->length);
    memcpy( res->_str, a->_str, a->length );
    memcpy( res->_str+a->length, b->_str, b->length);
    return makeStringValue(res);
}

bool less (StringPrim * a, StringPrim * b)
{
    return strcmp(a->getStr(), b->getStr()) < 0; // FIXME: UTF-8
}


}
