// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/runtime.h"

#include <math.h>
#include <stdlib.h>
#include <assert.h>
#include <ctype.h>

// Need our own definition to avoid warnings when using it on C++ objects
#define OFFSETOF(type, field)  ((char*)&(((type*)0)->field) - ((char*)0) )

namespace js
{

void Memory::finalizer ()
{ }

Memory::~Memory ()
{ }

bool Env::mark (IMark * marker, unsigned markBit)
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

bool Object::mark (IMark * marker, unsigned markBit)
{
    if (!markMemory(marker, markBit, parent))
        return false;
    for (const auto & it : props)
        if (!markValue(marker, markBit, it.second.value))
            return false;
    return true;
}

Object * Object::defineOwnProperty (StackFrame * caller, const std::string name, unsigned flags, TaggedValue value,
                                    Function * get, Function * set
)
{
    auto it = props.find(name);
    Property * prop;
    if (it != props.end()) {
        if (!(it->second.flags & PROP_CONFIGURABLE))
            throwTypeError(caller, "Cannot redefine property:" + name);
        prop = &it->second;
    } else {
        prop = &props.insert(std::make_pair(name, Property())).first->second;
    }
    prop->flags = flags;
    if (flags & PROP_GET_SET)
        prop->value = makeMemoryValue(VT_MEMORY, new(caller) PropertyAccessor(get, set));
    else
        prop->value = JS_UNDEFINED_VALUE;

    return this;
}

Property * Object::getProperty (const std::string & name)
{
    Object * cur = this;
    do {
        if (Property * p = cur->getOwnProperty(name))
            return p;
    } while ((cur = this->parent) != NULL);
    return NULL;
}

TaggedValue Object::get (StackFrame * caller, const std::string & name)
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

void Object::put (StackFrame * caller, const std::string & name, TaggedValue v)
{
    Object * cur = this;
    do {
        if (Property * p = cur->getOwnProperty(name)) {
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
                        (*setter->code)(caller, setter->env, 2, frame.locals);
                    }
                } else {
                    goto cannotWrite;
                }
            }
        }
    } while ((cur = this->parent) != NULL);

    if (this->flags & OF_NOEXTEND)
        goto cannotWrite;

    this->props.emplace(PROP_WRITEABLE|PROP_ENUMERABLE|PROP_CONFIGURABLE, v);
    return;

cannotWrite:;
    // FIXME: throw in strict mode
}

bool Object::deleteProperty (const std::string & name)
{
    auto it = props.find(name);
    if (it != props.end()) {
        if (!(it->second.flags & PROP_CONFIGURABLE)) {
            // TODO: throw if strict mode
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
    if (isCallable(frame.locals[0])) {
        tmp = frame.locals[0].raw.oval->call(caller, 1, &frame.locals[1]);
        if (isValueTagPrimitive((ValueTag)tmp.tag))
            return tmp;
    }
    if (preferredType == VT_NUMBER)
        goto error;

preferNumber:
    frame.locals[0] = get(&frame, "valueOf");
    if (isCallable(frame.locals[0])) {
        tmp = frame.locals[0].raw.oval->call(caller, 1, &frame.locals[1]);
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

bool PropertyAccessor::mark (IMark * marker, unsigned markBit)
{
    return markMemory(marker, markBit, get) && markMemory(marker, markBit, set);
}

bool Array::mark (IMark * marker, unsigned markBit)
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

TaggedValue Array::getElem (unsigned index)
{
    return index < elems.size() ? elems[index] : JS_UNDEFINED_VALUE;
}

void Array::setElem (unsigned index, TaggedValue v)
{
    if (index >= elems.size())
        setLength(index + 1);
    elems[index] = v;
}

Function::Function (StackFrame * caller, Object * parent, Env * env, const std::string & name, unsigned length,
                    CodePtr code
) :
    Object(parent), prototype(NULL), env(env), length(length), code(code)
{
    defineOwnProperty(caller, "length", 0, makeNumberValue(length));
    defineOwnProperty(caller, "name", 0, makeStringValue(caller, name));
    defineOwnProperty(caller, "arguments", 0, JS_NULL_VALUE);
    defineOwnProperty(caller, "caller", 0, JS_NULL_VALUE);
}

bool Function::mark (IMark * marker, unsigned markBit)
{
    return Object::mark(marker, markBit) && markMemory(marker, markBit, prototype) && markMemory(marker, markBit, env);
}

void Function::definePrototype (StackFrame * caller, Object * prototype)
{
    this->prototype = prototype;
    defineOwnProperty(caller, "prototype", 0, makeObjectValue(prototype));
}

bool Function::isCallable () const
{
    return true;
}

TaggedValue Function::call (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    return (*this->code)(caller, this->env, argc, argv);
}

bool StringPrim::mark (IMark * marker, unsigned markBit)
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

bool String::mark (IMark * marker, unsigned markBit)
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

bool StackFrame::mark (IMark * marker, unsigned markBit)
{
    // markMemory( marker, env );
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

bool Runtime::MemoryHead::mark (IMark *, unsigned)
{ return true; }

Runtime::Runtime ()
{
    diagFlags = DIAG_ALL;
    env = NULL;
    markBit = 0;
    head.header = 0;
    tail = &head;
    allocatedSize = 0;
    gcThreshold = 100;

    // Note: we need to be extra careful to store allocated values where the FC can trace them.
    StackFrameN<0, 5, 0> frame(this, NULL, NULL, __FILE__ ":Runtime::Runtime()", __LINE__);

    env = Env::make(&frame, NULL, 10);

    objectPrototype = new(&frame) Object(NULL);
    frame.locals[0] = makeObjectValue(objectPrototype);
    // TODO: 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    // TODO: '__defineGetter__', '__lookupGetter__', '__defineSetter__', '__lookupSetter__', '__proto__'

    functionPrototype = new(&frame) Function(&frame, objectPrototype, env, "functionPrototype", 0, emptyFunc);
    frame.locals[1] = makeObjectValue(functionPrototype);
    // TODO: in functionPrototype define bind, toString, call, apply

    object = new(&frame) Function(&frame, functionPrototype, env, "Object", 1, objectFunc);
    env->vars[0] = makeObjectValue(object);
    // TODO: keys, create, defineOwnProperty, defineProperties, freeze, getPrototypeOf, setPrototypeOf,
    // TODO: getOwnPropertyDescriptor(), getOwnPropertyNames(), is, isExtensible, isFrozen, isSealed, preventExtensions,
    // TODO: seal, getOwnPropertySymbols, deliverChangeRecords, getNotifier, observe, unobserve
    // TODO: arity? (from spidermonkey)
    object->definePrototype(&frame, objectPrototype);

    function = new(&frame) Function(&frame, functionPrototype, env, "Function", 1, functionFunc);
    env->vars[1] = makeObjectValue(function);
    function->definePrototype(&frame, functionPrototype);

    objectPrototype->defineOwnProperty(
        &frame, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(object));
    functionPrototype->defineOwnProperty(
        &frame, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(function));

    // String
    //
    stringPrototype = new(&frame) Object(objectPrototype);
    frame.locals[2] = makeObjectValue(stringPrototype);

    string = new(&frame) Function(&frame, functionPrototype, env, "String", 1, stringFunc);
    env->vars[2] = makeObjectValue(string);
    string->definePrototype(&frame, stringPrototype);

    stringPrototype->defineOwnProperty(
        &frame, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(string));

    // Number
    //
    numberPrototype = new(&frame) Object(objectPrototype);
    frame.locals[3] = makeObjectValue(numberPrototype);

    number = new(&frame) Function(&frame, functionPrototype, env, "Number", 1, numberFunc);
    env->vars[3] = makeObjectValue(number);
    number->definePrototype(&frame, numberPrototype);

    numberPrototype->defineOwnProperty(
        &frame, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(number));

    // Boolean
    //
    booleanPrototype = new(&frame) Object(objectPrototype);
    frame.locals[4] = makeObjectValue(booleanPrototype);

    boolean = new(&frame) Function(&frame, functionPrototype, env, "Boolean", 1, booleanFunc);
    env->vars[4] = makeObjectValue(boolean);
    boolean->definePrototype(&frame, booleanPrototype);

    booleanPrototype->defineOwnProperty(
        &frame, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(boolean));

    // True and False objects
    env->vars[5] = makeObjectValue(trueObject = new Boolean(booleanPrototype, makeBooleanValue(true)));
    env->vars[6] = makeObjectValue(falseObject = new Boolean(booleanPrototype, makeBooleanValue(false)));


    // Perm strings
    permStrUndefined = definePermString(&frame, "undefined");
    permStrNull = definePermString(&frame, "null");
    permStrTrue = definePermString(&frame, "true");
    permStrFalse = definePermString(&frame, "false");
    permStrNaN = definePermString(&frame, "NaN");
}

bool Runtime::mark (IMark * marker, unsigned markBit)
{
    for ( auto it : this->permStrings )
        it->second->mark(marker, markBit);
    return markMemory(marker, markBit, env);
}

TaggedValue Runtime::definePermString (StackFrame * caller, const std::string & str)
{
    StringPrim * res;
    auto it = permStrings.find(str);
    if (it == permStrings.end())
        permStrings[str] = res = StringPrim::make(caller, str);
    else
        res = it->second;
    return makeStringValue(res);
}

TaggedValue newFunction (StackFrame * caller, Env * env, const std::string & name, unsigned length, CodePtr code)
{
    StackFrameN<0, 2, 0> frame(caller, env, __FILE__ ":newFunction", __LINE__);
    Function * func;
    frame.locals[0] = makeObjectValue(
        func = new(caller) Function(caller, caller->runtime->functionPrototype, env, name, length, code));

    frame.locals[1] = makeObjectValue(new(caller) Object(caller->runtime->objectPrototype));
    frame.locals[1].raw.oval->defineOwnProperty(
        caller, "constructor", PROP_WRITEABLE | PROP_CONFIGURABLE, frame.locals[0]
    );

    func->definePrototype(caller, frame.locals[1].raw.oval);

    return frame.locals[0];
}

void throwTypeError (StackFrame * caller, const std::string & str)
{
    // TODO:
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

Object * toObject (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:
        case VT_NULL:
            throwTypeError(caller, "Cannot be converted to an object");

        case VT_BOOLEAN:    return v.raw.bval ? caller->runtime->trueObject : caller->runtime->falseObject;
        case VT_NUMBER:     return new Number(caller->runtime->numberPrototype, v);
        case VT_STRINGPRIM: return new String(caller->runtime->stringPrototype, v);
        default:
            assert(isValueTagObject((ValueTag)v.tag));
            return v.raw.oval;
    }
}

TaggedValue toString (StackFrame * caller, double n)
{
    if (isnan(n))
        return caller->runtime->permStrNaN;
    else {
        char buf[64];
        sprintf(buf, "%f", n);
        return makeStringValue(caller, buf);
    }
}

TaggedValue toString (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:  return caller->runtime->permStrUndefined;
        case VT_NULL:       return caller->runtime->permStrNull;
        case VT_BOOLEAN:    return v.raw.bval ? caller->runtime->permStrTrue : caller->runtime->permStrFalse;
        case VT_NUMBER:     return toString(caller, v.raw.nval);
        case VT_STRINGPRIM: return v;
        case VT_OBJECT: {
            StackFrameN<0,1,1> frame(caller, NULL, __FILE__ ":toString", __LINE__);
            frame.locals[0] = toPrimitive(caller, v, VT_STRINGPRIM);
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
            frame.locals[0] = toPrimitive(caller, v, VT_NUMBER);
            return toNumber(&frame, frame.locals[0]);
        }
        default:
            assert(false);
    };
}

int32_t toInt32 (StackFrame * caller, TaggedValue v)
{
    double num = toNumber(caller, v);
    if (isnan(num) || isinf(num) || !num)
        return 0;
    return (int32_t)num;
}

TaggedValue concatString (StackFrame * caller, StringPrim * a, StringPrim * b)
{
    StringPrim * res = StringPrim::makeEmpty(caller, a->length + b->length);
    memcpy( res->_str, a->_str, a->length );
    memcpy( res->_str+a->length, b->_str, b->length);
    return makeStringValue(res);
}

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

}
