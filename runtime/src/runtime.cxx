// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/runtime.h"

#include <assert.h>
#include <stdarg.h>
#include <errno.h>
#include <set>

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

Object * Object::createDescendant (StackFrame * caller)
{
    return new (caller) Object(this);
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

Object * Object::defineOwnProperty (StackFrame * caller, const StringPrim * name, unsigned flags, TaggedValue value)
{
    auto it = props.find(name->getStr());
    if (it != props.end()) {
        if ((this->flags & OF_NOCONFIG) || !(it->second.flags & PROP_CONFIGURABLE)) {
            throwTypeError(caller, "Cannot redefine property '%s'", name->getStr());
        }

        Property * prop = &it->second;
        prop->flags = flags;
        prop->value = value;
    } else {
        if (this->flags & OF_NOCONFIG)
            throwTypeError(caller, "Cannot define property '%s'", name->getStr());

        Property * prop = &props.emplace(
            std::piecewise_construct, std::make_tuple(name->getStr()), std::make_tuple(name, flags, value)
        ).first->second;
        this->propList.insertBefore(prop);

        // If index-like properties have been defined in this object, array accesses need to check them first
        uint32_t dummy;
        if (isIndexString(name->getStr(), &dummy))
            this->flags |= OF_INDEX_PROPERTIES;
    }

    return this;
}

Property * Object::getProperty (const StringPrim * name, Object ** propObj)
{
    Object * cur = this;
    do {
        if (Property * p = cur->getOwnProperty(name)) {
            *propObj = cur;
            return p;
        }
    } while ((cur = cur->parent) != NULL);
    return NULL;
}

bool Object::hasProperty (const StringPrim * name)
{
    Object * propObj;
    return getProperty(name, &propObj) != NULL;
};

bool Object::updatePropertyValue (StackFrame * caller, Object * propObj, Property * p, TaggedValue v)
{
    assert(!(this->flags & OF_NOWRITE));

    if (JS_LIKELY(!(p->flags & PROP_GET_SET))) {
        if (JS_LIKELY(p->flags & PROP_WRITEABLE)) {
            if (propObj == this) {
                p->value = v;
                return true;
            } else {
                return false;
            }
        }
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
            return true;
        }
    }

    if (JS_IS_STRICT_MODE(caller))
        throwTypeError(caller, "Property '%s' is not writable", p->name->getStr());
    return true;
}

TaggedValue Object::get (StackFrame * caller, const StringPrim * name)
{
    Object * propObj;
    if (Property * p = getProperty(name, &propObj))
        return getPropertyValue(caller, p);
    return JS_UNDEFINED_VALUE;
}

void Object::put (StackFrame * caller, const StringPrim * name, TaggedValue v)
{
    if (JS_LIKELY(!(this->flags & OF_NOWRITE))) {
        Object * propObj;
        if (Property * p = getProperty(name, &propObj))
            if (updatePropertyValue(caller, propObj, p, v))
                return;

        if (JS_LIKELY(!(this->flags & OF_NOEXTEND)))
        {
            Property * prop = &this->props.emplace(
                std::piecewise_construct, std::make_tuple(name->getStr()),
                std::make_tuple(name, PROP_WRITEABLE|PROP_ENUMERABLE|PROP_CONFIGURABLE, v)
            ).first->second;
            this->propList.insertBefore(prop);
            return;
        }
    }

    if (JS_IS_STRICT_MODE(caller))
        throwTypeError(caller, "Property '%s' is not writable", name->getStr());
}

bool Object::hasComputed (StackFrame * caller, TaggedValue propName)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::hasComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return this->hasProperty(frame.locals[0].raw.sval);
}

TaggedValue Object::getComputed (StackFrame * caller, TaggedValue propName)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return this->get(&frame, frame.locals[0].raw.sval);
}

void Object::putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::putComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    this->put(&frame, frame.locals[0].raw.sval, v);
}

bool Object::deleteProperty (StackFrame * caller, const StringPrim * name)
{
    auto it = props.find(name->getStr());
    if (it != props.end()) {
        if ((this->flags & OF_NOCONFIG) || !(it->second.flags & PROP_CONFIGURABLE)) {
            if (JS_IS_STRICT_MODE(caller))
                throwTypeError(caller, "Property '%s' is not deletable", name);
            return false;
        }
        it->second.remove();
        props.erase(it);
    }
    return true;
}

bool Object::deleteComputed (StackFrame * caller, TaggedValue propName)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::deleteComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return this->deleteProperty(&frame, frame.locals[0].raw.sval);
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
    frame.locals[0] = get(&frame, JS_GET_RUNTIME(&frame)->permStrToString);
    if (Function * func = js::isCallable(frame.locals[0])) {
        tmp = func->call(&frame, 1, &frame.locals[1]);
        if (isValueTagPrimitive(tmp.tag))
            return tmp;
    }
    if (preferredType == VT_NUMBER)
        goto error;

preferNumber:
    frame.locals[0] = get(&frame, JS_GET_RUNTIME(&frame)->permStrValueOf);
    if (Function * func = js::isCallable(frame.locals[0])) {
        tmp = func->call(&frame, 1, &frame.locals[1]);
        if (isValueTagPrimitive(tmp.tag))
            return tmp;
    }
    if (preferredType == VT_NUMBER)
        goto preferString;

error:
    throwTypeError(&frame, "Cannot determine default value");
}

bool PropertyAccessor::mark (IMark * marker, unsigned markBit) const
{
    return markMemory(marker, markBit, get) && markMemory(marker, markBit, set);
}

bool ArrayBase::mark (IMark * marker, unsigned markBit) const
{
    if (!Object::mark(marker, markBit))
        return false;
    for (const auto & value : elems)
        if (!markValue(marker, markBit, value))
            return false;
    return true;
}

void ArrayBase::setLength (unsigned newLen)
{
    elems.resize(newLen, TaggedValue{VT_ARRAY_HOLE});
}

void ArrayBase::setElem (unsigned index, TaggedValue v)
{
    if (index >= elems.size())
        setLength(index + 1);
    elems[index] = v;
}

bool ArrayBase::hasComputed (StackFrame * caller, TaggedValue propName)
{
    uint32_t index;
    // Fast path
    if (!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index))
        return hasElem(index);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::hasComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        if (hasProperty(frame.locals[0].raw.sval))
            return true;
    }

    if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
        return hasElem(index);

    return this->hasProperty(frame.locals[0].raw.sval);
}

TaggedValue ArrayBase::getComputed (StackFrame * caller, TaggedValue propName)
{
    uint32_t index;
    // Fast path
    if (!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index))
        return getElem(index);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        Object * propObj;
        if (Property * p = getProperty(frame.locals[0].raw.sval, &propObj))
            return getPropertyValue(caller, p);
    }

    if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
        return getElem(index);

    return this->get(&frame, frame.locals[0].raw.sval);
}

void ArrayBase::putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v)
{
    if (JS_UNLIKELY(this->flags & OF_NOWRITE)) { // Let the base implementation handle the error
        Object::putComputed(caller, propName, v);
        return;
    }

    uint32_t index;
    // Fast path
    if (!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index)) {
        setElem(index, v);
        return;
    }

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::putComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        Object * propObj;
        if (Property * p = getProperty(frame.locals[0].raw.sval, &propObj))
            if (updatePropertyValue(caller, propObj, p, v))
                return;
    }

    if (isIndexString(frame.locals[0].raw.sval->getStr(), &index)) {
        setElem(index, v);
        return;
    }

    this->put(&frame, frame.locals[0].raw.sval, v);
}

bool ArrayBase::deleteComputed (StackFrame * caller, TaggedValue propName)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::deleteComputed()", __LINE__);

    if (JS_UNLIKELY(this->flags & OF_INDEX_PROPERTIES)) {
        // index-like properties exist in the object, so we must check them first
        frame.locals[0] = toString(&frame, propName);
        if (hasOwnProperty(frame.locals[0].raw.sval))
            return deleteProperty(&frame, frame.locals[0].raw.sval);
    }

    uint32_t index;
    if (JS_UNLIKELY(!isValidArrayIndexNumber(propName, &index))) {
        if (JS_LIKELY(frame.locals[0].tag == VT_UNDEFINED)) // if we didn't already convert it to string
            frame.locals[0] = toString(&frame, propName);

        if (!isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return this->deleteProperty(&frame, frame.locals[0].raw.sval);
    }

    if (JS_LIKELY(index) < this->elems.size()) {
        TaggedValue * pe = &this->elems[index];
        if (JS_LIKELY(pe->tag != VT_ARRAY_HOLE)) {
            if (JS_LIKELY(!(this->flags & OF_NOCONFIG))) {
                *pe = TaggedValue{VT_ARRAY_HOLE};
            } else {
                if (JS_IS_STRICT_MODE(&frame))
                    throwTypeError(&frame, "Cannot delete property");
                return false;
            }
        }
    }
    return true;
}

void Array::init (StackFrame * caller)
{
    StackFrameN<0,3,0> frame(caller, NULL, __FILE__ ":Array::init", __LINE__);
    Runtime * r = JS_GET_RUNTIME(&frame);
    frame.locals[0] = newFunction(&frame, NULL, r->permStrLength, 0, lengthGetter);
    frame.locals[1] = newFunction(&frame, NULL, r->permStrLength, 1, lengthSetter);
    frame.locals[2] = makeMemoryValue(
        VT_MEMORY, new(&frame) PropertyAccessor(frame.locals[0].raw.fval, frame.locals[1].raw.fval)
    );

    defineOwnProperty(&frame, r->permStrLength, PROP_WRITEABLE|PROP_GET_SET, frame.locals[2]);
}

Array * Array::findArrayInstance (StackFrame * caller, TaggedValue thisp)
{
    Object * arrayProto = JS_GET_RUNTIME(caller)->arrayPrototype;

    if (isValueTagObject(thisp.tag)) {
        Object * obj = thisp.raw.oval;
        do
            if (obj->parent == arrayProto)
                return (Array *)obj;
        while ((obj = obj->parent) != NULL);
    }

    throwTypeError(caller, "not an instance of Array");
    return NULL;
}

TaggedValue Array::lengthGetter (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    assert(argc == 1);
    return makeNumberValue(findArrayInstance(caller, argv[0])->getLength());
}

TaggedValue Array::lengthSetter (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    assert(argc == 2);
    TaggedValue n = makeNumberValue(toNumber(caller, argv[1]));
    uint32_t len;
    if (!isValidArrayIndexNumber(n, &len))
        throwTypeError(caller, "Invalid array length");
    findArrayInstance(caller, argv[0])->setLength(len);
    return JS_UNDEFINED_VALUE;
}

Object * ArrayCreator::createDescendant (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayCreator::createDescendant", __LINE__);
    frame.locals[0] = makeObjectValue(new (&frame) Array(this));
    ((Array*)frame.locals[0].raw.oval)->init(&frame);
    return frame.locals[0].raw.oval;
}

void Arguments::init (StackFrame * caller, int argc, const TaggedValue * argv)
{
    elems.assign(argv, argv+argc);
    defineOwnProperty(caller, JS_GET_RUNTIME(caller)->permStrLength, PROP_WRITEABLE|PROP_CONFIGURABLE,
                      makeNumberValue(argc));
}

void ForInIterator::make (StackFrame * caller, TaggedValue * result, Object * obj)
{
    ForInIterator * iter;
    *result = makeMemoryValue(VT_MEMORY, iter = new (caller) ForInIterator());
    iter->init(caller, obj);
}

void ForInIterator::init (StackFrame * caller, Object * obj)
{
    m_obj = obj;
    std::set<const StringPrim *, less_StringPrim> used;

    do {
        for ( const ListEntry * entry = obj->propList.next; entry != &obj->propList; entry = entry->next ) {
            const Property * prop = static_cast<const Property *>(entry);
            // NOTE: non-enumerable properties in descendants hide enumerable properties in ancestors, so
            // we add then in 'used' even if we don't add them to propNames
            if (used.find(prop->name) == used.end()) {
                used.insert(prop->name);
                if ((prop->flags & PROP_ENUMERABLE) != 0)
                    m_propNames.push_back(prop->name);
            }
        }
    } while ((obj = obj->parent) != NULL);

    m_array = dynamic_cast<ArrayBase*>(m_obj);
    m_curIndex = 0;
    m_curName = m_propNames.begin();
}

bool ForInIterator::next (StackFrame * caller, TaggedValue * result)
{
    if (m_array) {
        if (JS_LIKELY(!(m_obj->flags & OF_INDEX_PROPERTIES))) {
            for ( unsigned index; (index = m_curIndex++) < m_array->elems.size(); ) {
                if (m_array->elems[index].tag != VT_ARRAY_HOLE) {
                    *result = toString(caller, index);
                    return true;
                }
            }
        } else {
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ForInIterator::next", __LINE__);

            for ( unsigned index; (index = m_curIndex++) < m_array->elems.size(); ) {
                frame.locals[0] = toString(&frame, index);

                Object * propObj;
                if (Property * p = m_obj->getProperty(frame.locals[0].raw.sval, &propObj)) {
                    if (p->flags & PROP_ENUMERABLE) {
                        *result = frame.locals[0];
                        return true;
                    }
                    // Note that if the property is not enumerable, but it exists, we must skip it
                }
                else if (m_array->elems[index].tag != VT_ARRAY_HOLE) {
                    *result = frame.locals[0];
                    return true;
                }
            }
        }
        // The array was consumed
        m_array = NULL;
    }

    while (JS_LIKELY(m_curName != m_propNames.end())) {
        Object * propObj;
        Property * prop = m_obj->getProperty(*m_curName++, &propObj);
        if (JS_LIKELY(prop != NULL && (prop->flags & PROP_ENUMERABLE))) {
            *result = makeStringValue(prop->name);
            return true;
        }
    }

    return false;
}


bool ForInIterator::mark (IMark * marker, unsigned markBit) const
{
    if (!markMemory(marker, markBit, m_obj))
        return false;
    // We could only mark the names that haven't been enumerated yet, but why??
    for ( const auto & it : m_propNames )
        if (!markMemory(marker, markBit, it))
            return false;
    return true;
}

void Function::init (StackFrame * caller, Env * env, CodePtr code, CodePtr consCode, const StringPrim * name, unsigned length)
{
    Runtime * r = JS_GET_RUNTIME(caller);

    this->env = env;
    this->code = code;
    this->consCode = consCode;
    if (!name)
        name = r->permStrEmpty;
    this->length = length;
    defineOwnProperty(caller, r->permStrLength, 0, makeNumberValue(length));
    defineOwnProperty(caller, r->permStrName, 0, makeStringValue(name));
    if (r->strictMode) {
        defineOwnProperty(caller, r->permStrCaller, PROP_GET_SET, r->strictThrowerAccessor);
        defineOwnProperty(caller, r->permStrCallee, PROP_GET_SET, r->strictThrowerAccessor);
        defineOwnProperty(caller, r->permStrArguments, PROP_GET_SET, r->strictThrowerAccessor);
    } else {
        defineOwnProperty(caller, r->permStrCaller, PROP_WRITEABLE, JS_NULL_VALUE);
        defineOwnProperty(caller, r->permStrCallee, PROP_WRITEABLE, JS_NULL_VALUE);
        defineOwnProperty(caller, r->permStrArguments, PROP_WRITEABLE, JS_NULL_VALUE);
    }
}

bool Function::mark (IMark * marker, unsigned markBit) const
{
    return Object::mark(marker, markBit) && markMemory(marker, markBit, env);
}

void Function::definePrototype (StackFrame * caller, Object * prototype, unsigned propFlags)
{
    defineOwnProperty(caller, JS_GET_RUNTIME(caller)->permStrPrototype, propFlags, makeObjectValue(prototype));
}

bool Function::hasInstance (StackFrame * caller, Object * inst)
{
    TaggedValue prototype = this->get(caller, JS_GET_RUNTIME(caller)->permStrPrototype);
    if (!isValueTagObject(prototype.tag))
        throwTypeError(caller, "Function has no valid 'prototype' property");
    while ((inst = inst->parent) != NULL)
        if (inst == prototype.raw.oval)
            return true;
    return false;
}

TaggedValue Function::call (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    return (*this->code)(caller, this->env, argc, argv);
}
TaggedValue Function::callCons (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    return (*this->consCode)(caller, this->env, argc, argv);
}

bool BoundFunction::mark (IMark * marker, unsigned markBit) const
{
    if (!Function::mark(marker, markBit))
        return false;
    if (!markMemory(marker, markBit, this->target))
        return false;
    for ( unsigned i = 0, e = this->boundCount; i < e; ++i )
        if (!markValue(marker, markBit, this->boundArgs[i]))
            return false;
    return true;
}

TaggedValue BoundFunction::call (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,16,0> frame(caller, NULL, __FILE__ ":BoundFunction::call", __LINE__);
    unsigned const count = argc - 1;

    if (this->boundCount + count <= 16) {
        // Fast path - use the local frame as stack
        memcpy(&frame.locals[0], &this->boundArgs[0], sizeof(frame.locals[0]) * this->boundCount);
        memcpy(&frame.locals[this->boundCount], argv + 1, sizeof(frame.locals[0]) * count);

        return this->target->call(&frame, this->boundCount + count, &frame.locals[0]);
    } else {
        ArrayBase * argSlots;
        frame.locals[0] = makeObjectValue(argSlots = new(&frame) ArrayBase(JS_GET_RUNTIME(&frame)->arrayPrototype));
        argSlots->setLength(this->boundCount + count);

        memcpy(&argSlots->elems[0], &this->boundArgs[0], sizeof(argSlots->elems[0]) * this->boundCount);
        memcpy(&argSlots->elems[this->boundCount], argv + 1, sizeof(argSlots->elems[0]) * count);

        return this->target->call(&frame, this->boundCount + count, &argSlots->elems[0]);
    }
}

TaggedValue BoundFunction::callCons (StackFrame * caller, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,16,0> frame(caller, NULL, __FILE__ ":BoundFunction::callCons", __LINE__);
    unsigned const count = argc - 1;

    if (this->boundCount + count <= 16) {
        // Fast path - use the local frame as stack
        frame.locals[0] = argv[0]; // copy the supplied 'this'
        if (this->boundCount > 0)
            memcpy(&frame.locals[1], &this->boundArgs[1], sizeof(frame.locals[0]) * (this->boundCount - 1));
        memcpy(&frame.locals[this->boundCount], argv + 1, sizeof(frame.locals[0]) * count);

        return this->target->callCons(&frame, this->boundCount + count, &frame.locals[0]);
    } else {
        ArrayBase * argSlots;
        frame.locals[0] = makeObjectValue(argSlots = new(&frame) ArrayBase(JS_GET_RUNTIME(&frame)->arrayPrototype));
        argSlots->setLength(this->boundCount + count);

        argSlots->elems[0] = argv[0]; // copy the supplied 'this'
        if (this->boundCount > 0)
            memcpy(&argSlots->elems[1], &this->boundArgs[1], sizeof(argSlots->elems[0]) * (this->boundCount - 1));
        memcpy(&argSlots->elems[this->boundCount], argv + 1, sizeof(argSlots->elems[0]) * count);

        return this->target->callCons(&frame, this->boundCount + count, &argSlots->elems[0]);
    }
}

Object * BoundPrototype::createDescendant (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":BoundPrototype::createDescendant", __LINE__);
    frame.locals[0] = this->target->get(&frame, JS_GET_RUNTIME(&frame)->permStrPrototype);
    if (isValueTagObject(frame.locals[0].tag))
        return frame.locals[0].raw.oval->createDescendant(&frame);
    else
        return JS_GET_RUNTIME(&frame)->objectPrototype->createDescendant(&frame);
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

bool Box::mark (IMark * marker, unsigned markBit) const
{
    return Object::mark(marker, markBit) && markValue(marker, markBit, this->value);
}

TaggedValue Box::defaultValue (StackFrame *, ValueTag)
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

TaggedValue objectFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    TaggedValue value = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (value.tag == VT_UNDEFINED || value.tag == VT_NULL)
        return makeObjectValue(new (caller) Object(JS_GET_RUNTIME(caller)->objectPrototype));
    else
        return makeObjectValue(toObject(caller, value));
}
TaggedValue objectConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    TaggedValue value = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (value.tag != VT_UNDEFINED && value.tag != VT_NULL)
        return makeObjectValue(toObject(caller, value));

    return JS_UNDEFINED_VALUE;
}

TaggedValue functionFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    throwTypeError(caller, "'Function' (module-level 'eval') is not supported in  static compiler");
}
TaggedValue functionConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    throwTypeError(caller, "'Function' (module-level 'eval') is not supported in a static compiler");
}

/**
 * Function.prototype.apply()
 */
TaggedValue functionApply (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,16,0> frame(caller, NULL, __FILE__ ":functionApply", __LINE__);
    frame.locals[0] = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE; // thisArg
    TaggedValue argArray = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;

    if (argArray.tag == VT_NULL || argArray.tag == VT_UNDEFINED)
        return call(&frame, argv[0], 1, &frame.locals[0]);

    if (!isValueTagObject(argArray.tag))
        throwTypeError(&frame, "Function.prototype.apply() argArray parameter is not an object");

    uint32_t n = toUint32(&frame, get(&frame, argArray, JS_GET_RUNTIME(&frame)->permStrLength));
    if (JS_LIKELY(n <= 15)) {
        // Fast path: use argument slots allocated on the stack
        for ( uint32_t index = 0; index < n; ++index )
            frame.locals[index+1] = argArray.raw.oval->getComputed(&frame, makeNumberValue(index));

        return call(&frame, argv[0], n+1, &frame.locals[0]);
    } else {
        // Slow path: must allocate the arguments slots in heap
        ArrayBase * argSlots;
        frame.locals[1] = makeObjectValue(argSlots = new(&frame) ArrayBase(JS_GET_RUNTIME(&frame)->arrayPrototype));
        argSlots->setLength(n+1);
        argSlots->elems[0] = frame.locals[0]; // thisArg
        for ( uint32_t index = 0; index < n; ++index )
            argSlots->elems[index+1] = argArray.raw.oval->getComputed(&frame, makeNumberValue(index));

        return call(&frame, argv[0], n+1, &argSlots->elems[0]);
    }
}

/**
 * Function.prototype.bind
 */
TaggedValue functionBind (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":functionBind", __LINE__);
    unsigned bindArgCount = argc - 1; // number of bound arguments, including 'thisArg'

    Function * target;
    if (! (target = isCallable(argv[0])) )
        throwTypeError(&frame, "bind() first parameter is not callable");

    BoundFunction * boundFunc;
    frame.locals[0] = makeObjectValue(boundFunc = new(&frame) BoundFunction(
        JS_GET_RUNTIME(&frame)->functionPrototype,
        target,
        // If we are called without a 'thisArg', pass #undefined
        bindArgCount > 0 ? bindArgCount : 1, bindArgCount > 0 ? argv + 1 : &frame.locals[1]
    ));

    boundFunc->init(
        &frame, NULL, NULL, NULL, NULL,
        target->length >= bindArgCount - 1 ? target->length - bindArgCount - 1 : 0
    );

    frame.locals[1] = makeObjectValue(new(&frame) BoundPrototype(JS_GET_RUNTIME(&frame)->objectPrototype, target));
    boundFunc->definePrototype(&frame, frame.locals[1].raw.oval, 0);

    return frame.locals[0];
}

TaggedValue stringFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    return argc > 1 ? toString(caller, argv[1]) : makeStringValue(JS_GET_RUNTIME(caller)->permStrEmpty);
}
TaggedValue stringConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    ((String *)argv[0].raw.oval)->setValue(stringFunction(caller, NULL, argc, argv));
    return JS_UNDEFINED_VALUE;
}

TaggedValue numberFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    return makeNumberValue(argc > 1 ? toNumber(caller, argv[1]) : 0);
}
TaggedValue numberConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    ((Number *)argv[0].raw.oval)->setValue(numberFunction(caller, NULL, argc, argv));
    return JS_UNDEFINED_VALUE;
}

TaggedValue booleanFunction (StackFrame *, Env *, unsigned argc, const TaggedValue * argv)
{
    return makeBooleanValue(argc > 1 ? toBoolean(argv[1]) : false);
}
TaggedValue booleanConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    ((Boolean *)argv[0].raw.oval)->setValue(booleanFunction(caller, NULL, argc, argv));
    return JS_UNDEFINED_VALUE;
}

static void arrayInit (Array * array, unsigned argc, const TaggedValue * argv)
{
    uint32_t size;
    if (argc == 2 && isValidArrayIndexNumber(argv[1], &size)) { // size constructor?
        array->setLength(size);
    } else if (argc > 1) {
        array->setLength(argc - 1);
        for ( unsigned i = 1; i != argc; ++i )
            array->setElem(i - 1, argv[i]);
    }
}
TaggedValue arrayFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":arrayFunction", __LINE__);
    Array * array;

    frame.locals[0] = makeObjectValue(array = new (&frame) Array(JS_GET_RUNTIME(&frame)->arrayPrototype));
    arrayInit(array, argc, argv);
    return frame.locals[0];
}
TaggedValue arrayConstructor (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    arrayInit((Array *)argv[0].raw.oval, argc, argv);
    return JS_UNDEFINED_VALUE;
}

TaggedValue errorFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":errorFunction" , __LINE__);

    frame.locals[0] = makeObjectValue(new(&frame) Error(JS_GET_RUNTIME(&frame)->errorPrototype));
    frame.locals[1] = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    errorConstructor(&frame, NULL, 2, &frame.locals[0]);

    return frame.locals[0];
}
TaggedValue errorConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":errorConstructor" , __LINE__);
    TaggedValue thisp = argv[0];
    TaggedValue message = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (message.tag != VT_UNDEFINED) {
        frame.locals[0] = toString(&frame, message);
        put(&frame, thisp, JS_GET_RUNTIME(&frame)->permStrMessage, frame.locals[0]);
    }

    return JS_UNDEFINED_VALUE;
}

TaggedValue typeErrorFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":typeErrorFunction" , __LINE__);
    frame.locals[0] = makeObjectValue(JS_GET_RUNTIME(&frame)->typeErrorPrototype->createDescendant(&frame));
    frame.locals[1] = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    errorConstructor(&frame, NULL, 2, &frame.locals[0]);

    return frame.locals[0];
}
TaggedValue typeErrorConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    return errorConstructor(caller, NULL, argc, argv);
}

static TaggedValue strictThrower (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    throwTypeError(caller, "'caller', 'callee' and 'arguments' Function properties cannot be accessed in strict mode");
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
    StackFrameN<0, 1, 0> frame(NULL, NULL, __FILE__ ":Runtime::Runtime()", __LINE__);

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
    permStrCallee = internString(&frame, "callee");
    permStrObject = internString(&frame, "object");
    permStrBoolean = internString(&frame, "boolean");
    permStrNumber = internString(&frame, "number");
    permStrString = internString(&frame, "string");
    permStrFunction = internString(&frame, "function");
    permStrToString = internString(&frame, "toString");
    permStrValueOf = internString(&frame, "valueOf");
    permStrMessage = internString(&frame, "message");

    // Global env
    env = Env::make(&frame, NULL, 20);

    // strictThrowerFunction
    // Used as a "poison pill" when accessing forbidden properties
    {
        // Disable strict mode temporarily to avoid an endless loop
        bool saveStrict = this->strictMode;
        this->strictMode = false;

        Function * strictThrowerFunction = new(&frame) Function(NULL);
        frame.locals[0] = makeObjectValue(strictThrowerFunction);
        strictThrowerFunction->init(&frame, env, strictThrower, strictThrower, NULL, 0);

        env->vars[16] = strictThrowerAccessor = makePropertyAccessorValue(
            new(&frame) PropertyAccessor(strictThrowerFunction, strictThrowerFunction)
        );

        this->strictMode = saveStrict;
    }

    // Object.prototype
    //
    objectPrototype = new(&frame) Object(NULL);
    env->vars[0] = makeObjectValue(objectPrototype);


    // Function.prototype
    //
    functionPrototype = new(&frame) PrototypeCreator<Function,Function>(objectPrototype);
    env->vars[2] = makeObjectValue(functionPrototype);
    functionPrototype->init(&frame, env, emptyFunc, emptyFunc, internString(&frame,"functionPrototype"), 0);

    // Object
    //
    systemConstructor(
        &frame, 0,
        objectPrototype,
        objectConstructor, objectFunction, "Object", 1, NULL, &object
    );
    // Function
    //
    systemConstructor(
        &frame, 2,
        functionPrototype,
        functionConstructor, functionFunction, "Function", 1, NULL, &function
    );
    defineMethod(&frame, functionPrototype, "apply", 2, functionApply);
    defineMethod(&frame, functionPrototype, "bind", 1, functionBind);
    // String
    //
    systemConstructor(
        &frame, 4,
        new(&frame) PrototypeCreator<Object,String>(objectPrototype),
        stringConstructor, stringFunction, "String", 1, &stringPrototype, &string
    );
    // Number
    //
    systemConstructor(
        &frame, 6,
        new(&frame) PrototypeCreator<Object,Number>(objectPrototype),
        numberConstructor, numberFunction, "Number", 1, &numberPrototype, &number
    );
    // Boolean
    //
    systemConstructor(
        &frame, 8,
        new(&frame) PrototypeCreator<Object,Boolean>(objectPrototype),
        booleanConstructor, booleanFunction, "Boolean", 1, &booleanPrototype, &boolean
    );
    // Array
    //
    systemConstructor(
        &frame, 10,
        new(&frame) ArrayCreator(objectPrototype),
        arrayConstructor, arrayFunction, "Array", 1, &arrayPrototype, &array
    );
    // Error
    //
    systemConstructor(
        &frame, 12,
        new(&frame) PrototypeCreator<Error,Error>(objectPrototype),
        errorConstructor, errorFunction, "Error", 1, &errorPrototype, &error
    );
    // Error.prototype.name
    errorPrototype->defineOwnProperty(
        &frame, permStrName, PROP_NORMAL, makeStringValue(internString(&frame, "Error"))
    );
    // Error.prototype.message
    errorPrototype->defineOwnProperty( &frame, permStrMessage, PROP_NORMAL, makeStringValue(permStrEmpty));

    // TypeError
    //
    systemConstructor(
        &frame, 14,
        new(&frame) PrototypeCreator<Object,Error>(errorPrototype),
        typeErrorConstructor, typeErrorFunction, "TypeError", 1, &typeErrorPrototype, &typeError
    );
    // TypeError.prototype.name
    typeErrorPrototype->defineOwnProperty(
        &frame, permStrName, PROP_NORMAL, makeStringValue(internString(&frame, "TypeError"))
    );

    // Next free is env[17]
}

void Runtime::systemConstructor (
    StackFrame * caller, unsigned envIndex, Object * prototype, CodePtr code, CodePtr consCode,
    const char * name, unsigned length,
    Object ** outPrototype, Function ** outConstructor
)
{
    if (outPrototype) {
        env->vars[envIndex] = makeObjectValue(prototype);
        *outPrototype = prototype;
    }

    Function * constructor = new(caller) Function(functionPrototype);
    env->vars[envIndex+1] = makeObjectValue(constructor);
    constructor->init(caller, env, code, consCode, internString(caller, name), length);
    constructor->definePrototype(caller, prototype);

    prototype->defineOwnProperty(
        caller, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(constructor)
    );

    *outConstructor = constructor;
}

void Runtime::defineMethod (StackFrame * caller, Object * prototype, const char * sname, unsigned length, CodePtr code)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Runtime::defineMethod", __LINE__);
    const StringPrim * name = internString(&frame, sname);
    frame.locals[0] = newFunction(&frame, env, name, length, code);
    prototype->defineOwnProperty(&frame, name, PROP_WRITEABLE|PROP_CONFIGURABLE, frame.locals[0]);
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
        std::vector<char> buf(s, (const char *)strchr(s,0)+1);
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
        if (!markMemory(marker, markBit, it.second))
            return false;
    return
        markMemory(marker, markBit, env) &&
        markValue(marker, markBit, this->thrownObject);
}

bool Runtime::less_PasStr::operator() (const PasStr & a, const PasStr & b) const
{
    int rel;
    if (a.first == b.first)
        return memcmp(a.second, b.second, a.first) < 0;
    else if (a.first < b.first)
        return (rel = memcmp(a.second, b.second, a.first)) != 0 ? rel < 0 : true;
    else
        return (rel = memcmp(a.second, b.second, b.first)) != 0 ? rel < 0 : false;
}

const StringPrim * Runtime::internString (StackFrame * caller, const char * str, unsigned len)
{
    StringPrim * res;
    PasStr key(len, (const unsigned char *)str);
    auto it = permStrings.find(key);
    if (it == permStrings.end()) {
        res = StringPrim::make(caller, str, len);
        permStrings[PasStr(len, res->_str)] = res;
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

/**
 * @throws if parent is not an object or null
 */
Object * objectCreate (StackFrame * caller, TaggedValue parent)
{
    if (isValueTagObject(parent.tag))
        return parent.raw.oval->createDescendant(caller);
    else if (parent.tag == VT_NULL)
        return new (caller) Object(NULL);
    else {
        throwTypeError(caller, "Object prototype may only be an Object or null");
        return NULL;
    }
}

TaggedValue newFunction (StackFrame * caller, Env * env, const StringPrim * name, unsigned length, CodePtr code)
{
    StackFrameN<0, 2, 0> frame(caller, env, __FILE__ ":newFunction", __LINE__);
    Function * func;
    frame.locals[0] = makeObjectValue(
        func = new(&frame) Function(JS_GET_RUNTIME(&frame)->functionPrototype));
    func->init(&frame, env, code, code, name, length);

    frame.locals[1] = makeObjectValue(new(&frame) Object(JS_GET_RUNTIME(&frame)->objectPrototype));
    frame.locals[1].raw.oval->defineOwnProperty(
        &frame, JS_GET_RUNTIME(caller)->permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, frame.locals[0]
    );

    func->definePrototype(&frame, frame.locals[1].raw.oval, PROP_WRITEABLE);

    return frame.locals[0];
}

static void unhandledException (StackFrame * caller) JS_NORETURN;
static void unhandledException (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":unhandledException", __LINE__);
    frame.locals[0] = toString(&frame, JS_GET_RUNTIME(caller)->thrownObject);
    fprintf(stderr, "***Unhandled exception: %s\n", frame.locals[0].raw.sval->getStr());
    caller->printStackTrace();
    abort();
}

void throwValue (StackFrame * caller, TaggedValue val)
{
    Runtime * r = JS_GET_RUNTIME(caller);
    r->thrownObject = val;
    if (r->tryRecord)
        ::longjmp(r->tryRecord->jbuf, 1);
    else
        unhandledException(caller);
}

void throwOutOfMemory (StackFrame * caller)
{
    fprintf(stderr, "OUT OF MEMORY");
    caller->printStackTrace();
    throw std::bad_alloc();
}

void throwTypeError (StackFrame * caller, const char * msg, ...)
{
    StackFrameN<0,3,0> frame(caller, NULL, __FILE__ ":throwTypeError", __LINE__);

    char * buf;
    va_list ap;
    va_start(ap, msg);
    vasprintf(&buf, msg, ap);
    va_end(ap);

    if (!buf) {
        throwOutOfMemory(&frame);
    } else {
        frame.locals[0] = JS_UNDEFINED_VALUE;
        frame.locals[1] = makeStringValue(StringPrim::make(&frame, buf));
        free(buf);
        frame.locals[2] = typeErrorFunction(&frame, NULL, 2, &frame.locals[0]);

        throwValue(&frame, frame.locals[2]);
    }
}


TaggedValue call (StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv)
{
    if (Function * func = isCallable(value))
        return func->call(caller, argc, argv);

    throwTypeError(caller, "not a function");
    return JS_UNDEFINED_VALUE;
};

TaggedValue callCons (StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv)
{
    if (Function * func = isCallable(value))
        return func->callCons(caller, argc, argv);

    throwTypeError(caller, "not a function");
    return JS_UNDEFINED_VALUE;
};

bool isIndexString (const char * str, uint32_t * res)
{
    if (str[0] >= '0' && str[0] <= '9') { // Filter out the obvious cases
        char * end;
        errno = 0;
        unsigned long ul = strtoul(str, &end, 10);
        if (errno == 0 && *end == 0 && ul < UINT32_MAX) {
            *res = (uint32_t)ul;
            return true;
        }
    }
    return false;
}

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
                throwTypeError(caller, "cannot assign property '%s' of primitive", propName->getStr());
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
        case VT_FUNCTION: return obj.raw.oval->get(caller, propName); break;

        case VT_NUMBER:
        case VT_BOOLEAN:
        case VT_STRINGPRIM: {
            // TODO: avoid temporary object creation
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":get", __LINE__);
            Object * o = toObject(&frame, obj);
            frame.locals[0] = makeObjectValue(o);
            return o->get(&frame, propName);
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

bool toBoolean (TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:
        case VT_NULL:
            return false;
        case VT_BOOLEAN:
            return v.raw.bval;
        case VT_NUMBER:
            return !isnan(v.raw.nval) && v.raw.nval;
        case VT_STRINGPRIM:
            return v.raw.sval->length != 0;
        default:
            return true;
    }
}

Object * toObject (StackFrame * caller, TaggedValue v)
{
    switch (v.tag) {
        case VT_UNDEFINED:
        case VT_NULL:
            throwTypeError(caller, "Cannot be converted to an object");

        case VT_BOOLEAN:    return new (caller) Boolean(JS_GET_RUNTIME(caller)->booleanPrototype, v);
        case VT_NUMBER:     return new (caller) Number(JS_GET_RUNTIME(caller)->numberPrototype, v);
        case VT_STRINGPRIM: return new (caller) String(JS_GET_RUNTIME(caller)->stringPrototype, v);
        default:
            assert(isValueTagObject(v.tag));
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
        case VT_OBJECT:
        case VT_FUNCTION: {
                StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":toString", __LINE__);
            frame.locals[0] = toPrimitive(&frame, v, VT_STRINGPRIM);
            return toString(&frame, frame.locals[0]);
        }
        default:
            assert(false);
            return JS_UNDEFINED_VALUE;
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
        case VT_FUNCTION:
            return v.raw.oval->defaultValue(caller, preferredType);
        default:
            assert(false);
            return JS_UNDEFINED_VALUE;
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
        case VT_OBJECT:
        case VT_FUNCTION: {
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":toNumber", __LINE__);
            frame.locals[0] = toPrimitive(&frame, v, VT_NUMBER);
            return toNumber(&frame, frame.locals[0]);
        }
        default:
            assert(false);
            return NAN;
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
            return NAN;
    };
}

double toInteger (double n)
{
    if (JS_UNLIKELY(isnan(n)))
        return 0;
    if (JS_UNLIKELY(!isfinite(n)))
        return n;
    return n >= 0 ? floor(n) : ceil(n);
}

uint32_t toUint32 (StackFrame * caller, TaggedValue v)
{
    return toUint32(toNumber(caller, v));
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

bool less (const StringPrim * a, const StringPrim * b)
{
    return strcmp(a->getStr(), b->getStr()) < 0; // FIXME: UTF-8
}

bool equal (const StringPrim * a, const StringPrim * b)
{
    return a == b || strcmp(a->getStr(), b->getStr()) == 0;
}

}
