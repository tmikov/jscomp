// Copyright (c) 2015 Tzvetan Mikov and contributors (see AUTHORS).
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsruntime.h"
#include "jsc/jsimpl.h"
#include "jsc/config.h"
#include "jsc/sort.h"
#include "jsc/dtoa.h"

#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdarg.h>
#include <errno.h>
#include <set>
#include <tuple>
#include <memory>

namespace js
{

Runtime * g_runtime = NULL;

InternalClass Memory::getInternalClass () const
{
    return ICLS_MEMORY;
}

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

InternalClass Object::getInternalClass () const
{
    return ICLS_OBJECT;
}

Object * Object::createDescendant (StackFrame * caller)
{
    return newInit<Object>(caller, this);
}

ForInIterator * Object::makeIterator (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::makeIterator()", __LINE__);
    ForInIterator * it;
    frame.locals[0] = makeMemoryValue(VT_MEMORY, it = new(&frame) ForInIterator());
    it->initWithObject(&frame, this);
    return it;
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
    if (JS_UNLIKELY(!name->isInterned()))
        name = JS_GET_RUNTIME(caller)->internString(name);

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

#ifdef HAVE_CXX11_EMPLACE
        Property * prop = &props.emplace(
            std::piecewise_construct, std::make_tuple(name->getStr()), std::make_tuple(name, flags, value)
        ).first->second;
#else
        Property * prop = &props.insert(
            std::make_pair(name->getStr(), Property(name, flags, value))
        ).first->second;
#endif
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

TaggedValue Object::getOwn (StackFrame * caller, const StringPrim * name)
{
    if (Property * p = getOwnProperty(name))
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
            if (JS_UNLIKELY(!name->isInterned()))
                name = JS_GET_RUNTIME(caller)->internString(name);

#ifdef HAVE_CXX11_EMPLACE
            Property * prop = &this->props.emplace(
                std::piecewise_construct, std::make_tuple(name->getStr()),
                std::make_tuple(name, PROP_WRITEABLE|PROP_ENUMERABLE|PROP_CONFIGURABLE, v)
            ).first->second;
#else
            Property * prop = &this->props.insert(
                std::make_pair(name->getStr(), Property(name, PROP_WRITEABLE|PROP_ENUMERABLE|PROP_CONFIGURABLE, v))
            ).first->second;
#endif
            this->propList.insertBefore(prop);
            return;
        }
    }

    if (JS_IS_STRICT_MODE(caller))
        throwTypeError(caller, "Property '%s' is not writable", name->getStr());
}

bool Object::hasComputed (StackFrame * caller, TaggedValue propName, bool own)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::hasComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return JS_LIKELY(!own) ?
        this->hasProperty(frame.locals[0].raw.sval) : this->hasOwnProperty(frame.locals[0].raw.sval);
}

TaggedValue Object::getComputed (StackFrame * caller, TaggedValue propName, bool own)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);
    return JS_LIKELY(!own) ?
        this->get(&frame, frame.locals[0].raw.sval) : this->getOwn(&frame, frame.locals[0].raw.sval);
}

int Object::getComputedDescriptor (StackFrame * caller, TaggedValue propName, bool own, Property ** desc)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":Object::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    Object * propObj;
    if (Property * p = !own ? getProperty(frame.locals[0].raw.sval, &propObj) : getOwnProperty(frame.locals[0].raw.sval)) {
        *desc = p;
        return 1;
    } else {
        *desc = NULL;
        return 0;
    }
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

Array * Object::ownKeys (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":objectKeys()", __LINE__);

    // Count the elements
    unsigned n = 0;
    for ( const ListEntry * entry = this->propList.next; entry != &this->propList; entry = entry->next ) {
        const Property * prop = static_cast<const Property *>(entry);
        if ((prop->flags & PROP_ENUMERABLE) != 0)
            ++n;
    }

    Array * a;
    frame.locals[0] = js::makeObjectValue(a = new(&frame) Array(JS_GET_RUNTIME(caller)->arrayPrototype));
    a->init(&frame);

    // Try to be just a tad smarter here to avoid initializing the array redundantly
    a->elems.reserve(n);
    for ( const ListEntry * entry = this->propList.next; entry != &this->propList; entry = entry->next ) {
        const Property * prop = static_cast<const Property *>(entry);
        if ((prop->flags & PROP_ENUMERABLE) != 0)
            a->elems.push_back(js::makeStringValue(prop->name));
    }

    assert(a->getLength() == n);
    return a;
}

uintptr_t Object::getInternalProp (unsigned index) const
{
    return 0;
}

void Object::setInternalProp (unsigned index, uintptr_t value)
{
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

NativeObject * NativeObject::make (StackFrame * caller, Object * parent, unsigned internalPropCount)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":NativeObject::make()", __LINE__);

    if (internalPropCount < 1)
        internalPropCount = 1;

    NativeObject * res = new(&frame,OFFSETOF(NativeObject,internalProps) + sizeof(uintptr_t)*internalPropCount)
            NativeObject(parent, internalPropCount);
    frame.locals[0] = makeObjectValue(res);
    res->init(&frame);
    return res;
}

NativeObject * NativeObject::make (StackFrame * caller, unsigned internalPropCount)
{
    return make(caller, JS_GET_RUNTIME(caller)->objectPrototype, internalPropCount);
}

NativeObject::NativeObject (Object * parent, unsigned internalCount) :
    Object(parent),
    icls(ICLS_OBJECT),
    nativeFinalizer(NULL),
    internalCount(internalCount)
{
   memset(this->internalProps, 0, sizeof(this->internalProps[0])*internalCount);
}

InternalClass NativeObject::getInternalClass () const
{
    return this->icls;
}

Object * NativeObject::createDescendant (StackFrame * caller)
{
    return NativeObject::make(caller, this, this->internalCount);
}

uintptr_t NativeObject::getInternalProp (unsigned index) const
{
    return getInternal(index);
}
void NativeObject::setInternalProp (unsigned index, uintptr_t value)
{
    setInternal(index, value);
}

NativeObject::~NativeObject ()
{
    if (this->nativeFinalizer)
        (*this->nativeFinalizer)(this);
}

ForInIterator * IndexedObject::makeIterator (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":IndexedObject::makeIterator()", __LINE__);
    ForInIndexedIterator * it;
    frame.locals[0] = makeMemoryValue(VT_MEMORY, it = new(&frame) ForInIndexedIterator());
    it->initWithIndexed(&frame, this);
    return it;
}

bool IndexedObject::hasComputed (StackFrame * caller, TaggedValue propName, bool own)
{
    uint32_t index;
    // Fast path
    if (JS_LIKELY(!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index)))
        return hasIndex(index);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::hasComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        if (!own ? hasProperty(frame.locals[0].raw.sval) : hasOwnProperty(frame.locals[0].raw.sval))
            return true;

        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return hasIndex(index);

        return false;
    } else {
        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return hasIndex(index);

        return !own ? hasProperty(frame.locals[0].raw.sval) : hasOwnProperty(frame.locals[0].raw.sval);
    }
}

TaggedValue IndexedObject::getComputed (StackFrame * caller, TaggedValue propName, bool own)
{
    uint32_t index;
    // Fast path
    if (JS_LIKELY(!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index)))
        return getAtIndex(caller, index);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        Object * propObj;
        if (Property * p = !own ? getProperty(frame.locals[0].raw.sval, &propObj) : getOwnProperty(frame.locals[0].raw.sval))
            return getPropertyValue(&frame, p);

        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return getAtIndex(&frame, index);

        return JS_UNDEFINED_VALUE;
    } else {
        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return getAtIndex(&frame, index);

        return this->get(&frame, frame.locals[0].raw.sval);
    }
}

int IndexedObject::getComputedDescriptor (StackFrame * caller, TaggedValue propName, bool own, Property ** desc)
{
    uint32_t index;

    *desc = NULL;

    // Fast path
    if (JS_LIKELY(!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index))) {
        return hasIndex(index) ? 2 : 0;
    }

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::getComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        Object * propObj;
        if (Property * p = !own ? getProperty(frame.locals[0].raw.sval, &propObj) : getOwnProperty(frame.locals[0].raw.sval)) {
            *desc = p;
            return 1;
        }

        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return hasIndex(index) ? 2 : 0;

        return 0;
    } else {
        if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
            return hasIndex(index) ? 2 : 0;

        Object * propObj;
        if (Property * p = !own ? getProperty(frame.locals[0].raw.sval, &propObj) : getOwnProperty(frame.locals[0].raw.sval)) {
            *desc = p;
            return 1;
        }

        return 0;
    }
}

void IndexedObject::putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v)
{
    if (JS_UNLIKELY(this->flags & OF_NOWRITE)) { // Let the base implementation handle the error
        super::putComputed(caller, propName, v);
        return;
    }

    uint32_t index;
    // Fast path
    if (!(this->flags & OF_INDEX_PROPERTIES) && isValidArrayIndexNumber(propName, &index)) {
        if (JS_UNLIKELY(!setAtIndex(caller, index, v) && JS_IS_STRICT_MODE(caller)))
            throwTypeError(caller, "cannot modify property [%lu]", (unsigned long)index);
        return;
    }

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBase::putComputed()", __LINE__);
    frame.locals[0] = toString(&frame, propName);

    if (this->flags & OF_INDEX_PROPERTIES) {
        // index-like properties exist in the object, so we must check them first
        Object * propObj;
        if (Property * p = getProperty(frame.locals[0].raw.sval, &propObj))
        if (updatePropertyValue(&frame, propObj, p, v))
            return;
    }

    if (isIndexString(frame.locals[0].raw.sval->getStr(), &index)) {
        if (JS_UNLIKELY(!setAtIndex(caller, index, v) && JS_IS_STRICT_MODE(caller)))
            throwTypeError(caller, "cannot modify property [%lu]", (unsigned long)index);
        return;
    }

    this->put(&frame, frame.locals[0].raw.sval, v);
}

bool IndexedObject::deleteComputed (StackFrame * caller, TaggedValue propName)
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

    bool res = deleteAtIndex(index);
    if (JS_UNLIKELY(!res && JS_IS_STRICT_MODE(&frame)))
        throwTypeError(&frame, "Cannot delete property [%lu]", (unsigned long)index);

    return res;
}

Array * IndexedObject::ownKeys (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":objectKeys()", __LINE__);
    uint32_t length = getIndexedLength();

    // Count the elements
    uint32_t n = 0;

    // First count only the real indexed properties
    for ( uint32_t i = 0; i < length; ++i ) {
        Property * prop;
        if (getComputedDescriptor(&frame, makeNumberValue(i), true, &prop) == 2)
            ++n;
    }

    for ( const ListEntry * entry = this->propList.next; entry != &this->propList; entry = entry->next ) {
        const Property * prop = static_cast<const Property *>(entry);
        if ((prop->flags & PROP_ENUMERABLE) != 0)
            ++n;
    }

    Array * a;
    frame.locals[0] = js::makeObjectValue(a = new(&frame) Array(JS_GET_RUNTIME(caller)->arrayPrototype));
    a->init(&frame);

    // Try to be just a tad smarter here to avoid initializing the array redundantly
    a->elems.reserve(n);

    for ( uint32_t i = 0; i < length; ++i ) {
        Property * prop;
        TaggedValue const & name = makeNumberValue(i);
        if (getComputedDescriptor(&frame, name, true, &prop) == 2) {
            a->elems.push_back(name);
        }
    }

    for ( const ListEntry * entry = this->propList.next; entry != &this->propList; entry = entry->next ) {
        const Property * prop = static_cast<const Property *>(entry);
        if ((prop->flags & PROP_ENUMERABLE) != 0)
            a->elems.push_back(js::makeStringValue(prop->name));
    }

    assert(a->getLength() == n);
    return a;
}

bool ArrayBase::mark (IMark * marker, unsigned markBit) const
{
    if (!super::mark(marker, markBit))
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

uint32_t ArrayBase::getIndexedLength () const
{
    return getLength();
}
bool ArrayBase::hasIndex (uint32_t index) const
{
    return hasElem(index);
}
TaggedValue ArrayBase::getAtIndex (StackFrame *, uint32_t index) const
{
    return getElem(index);
}
bool ArrayBase::setAtIndex (StackFrame *,uint32_t index, TaggedValue value)
{
    setElem(index, value);
    return true;
}
bool ArrayBase::deleteAtIndex (uint32_t index)
{
    if (JS_LIKELY(index) < this->elems.size()) {
        TaggedValue * pe = &this->elems[index];
        if (JS_LIKELY(pe->tag != VT_ARRAY_HOLE)) {
            if (JS_LIKELY(!(this->flags & OF_NOCONFIG))) {
                *pe = TaggedValue{VT_ARRAY_HOLE};
            } else {
                return false;
            }
        }
    }
    return true;
}

void Array::init (StackFrame * caller)
{
    super::init(caller);
    Runtime * r = JS_GET_RUNTIME(caller);
    defineOwnProperty(caller, r->permStrLength, PROP_WRITEABLE|PROP_GET_SET, r->arrayLengthAccessor);
}

InternalClass Array::getInternalClass () const
{
    return ICLS_ARRAY;
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

void Arguments::init (StackFrame * caller, int argc, const TaggedValue * argv)
{
    super::init(caller);
    elems.assign(argv, argv+argc);
    defineOwnProperty(caller, JS_GET_RUNTIME(caller)->permStrLength, PROP_WRITEABLE|PROP_CONFIGURABLE,
                      makeNumberValue(argc));
}

InternalClass Arguments::getInternalClass () const
{
    return ICLS_ARGUMENTS;
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

void ForInIterator::initWithObject (StackFrame * caller, Object * obj)
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

    m_curName = m_propNames.begin();
}

bool ForInIterator::next (StackFrame * caller, TaggedValue * result)
{
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

void ForInIndexedIterator::initWithIndexed (StackFrame * caller, IndexedObject * obj)
{
    super::initWithObject(caller, obj);
    m_indexed = obj;
    m_length = obj->getIndexedLength();
    m_curIndex = 0;
}

bool ForInIndexedIterator::next (StackFrame * caller, TaggedValue * result)
{
    if (JS_LIKELY(m_indexed)) {
        if (JS_LIKELY(!(m_obj->flags & OF_INDEX_PROPERTIES))) {
            for ( uint32_t index; (index = m_curIndex++) < m_length; ) {
                if (m_indexed->hasIndex(index)) {
                    *result = toString(caller, index);
                    return true;
                }
            }
        } else {
            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ForInIndexedIterator::next", __LINE__);

            for ( uint32_t index; (index = m_curIndex++) < m_length; ) {
                frame.locals[0] = toString(&frame, index);

                Object * propObj;
                if (Property * p = m_obj->getProperty(frame.locals[0].raw.sval, &propObj)) {
                    if (p->flags & PROP_ENUMERABLE) {
                        *result = frame.locals[0];
                        return true;
                    }
                    // Note that if the property is not enumerable, but it exists, we must skip it
                }
                else if (m_indexed->hasIndex(index)) {
                    *result = frame.locals[0];
                    return true;
                }
            }
        }
        // The array was consumed
        m_indexed = NULL;
    }

    return super::next(caller, result);
}

void Function::init (StackFrame * caller, Env * env, CodePtr code, CodePtr consCode, const StringPrim * name, unsigned length)
{
    super::init(caller);

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

InternalClass Function::getInternalClass () const
{
    return ICLS_FUNCTION;
}

bool Function::mark (IMark * marker, unsigned markBit) const
{
    return super::mark(marker, markBit) && markMemory(marker, markBit, env);
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

Object * FunctionCreator::createDescendant (StackFrame * caller)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":FunctionCreator::createDescendant()", __LINE__);
    Function * f;
    frame.locals[0] = makeObjectValue(f = new(&frame) Function(this));
    f->init(&frame, NULL, emptyFunc, emptyFunc, NULL, 0);
    return f;
}

bool BoundFunction::mark (IMark * marker, unsigned markBit) const
{
    if (!super::mark(marker, markBit))
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
        ArrayBase * argSlots = newInit<ArrayBase>(&frame, &frame.locals[0], JS_GET_RUNTIME(&frame)->arrayPrototype);
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
        ArrayBase * argSlots = newInit<ArrayBase>(&frame, &frame.locals[0], JS_GET_RUNTIME(&frame)->arrayPrototype);
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

InternalClass StringPrim::getInternalClass () const
{
    return ICLS_STRING_PRIM;
}

bool StringPrim::mark (IMark * marker, unsigned markBit) const
{
    return true;
}

StringPrim * StringPrim::makeEmpty (StackFrame * caller, unsigned length)
{
    return new(caller, OFFSETOF(StringPrim, _str) + length + 1) StringPrim(length);
}

StringPrim * StringPrim::makeFromValid (StackFrame * caller, const char * str, unsigned length, unsigned charLength)
{
    StringPrim * res = makeEmpty(caller, length);
    memcpy( res->_str, str, length);
    res->init(charLength);
    return res;
}

StringPrim * StringPrim::makeFromValid (StackFrame * caller, const char * str, unsigned length)
{
    return makeFromValid(
        caller, str, length, lengthInUTF16Units((const unsigned char *)str, (const unsigned char *)str + length));
}

StringPrim * StringPrim::makeFromASCII (StackFrame * caller, const char * str, unsigned length)
{
    StringPrim * res = makeEmpty(caller, length);
    unsigned char * d = res->_str;
    for ( unsigned len = length; len != 0; ++str, ++d, --len )
        *d = (unsigned char)(*str & 0x7F);
    res->init(length);
    return res;
}

StringPrim * StringPrim::makeFromUnvalidated (StackFrame * caller, const char * str, unsigned length)
{
    const unsigned UNI_REPLACEMENT_LENGTH = 3;

    unsigned actualLength = length;
    unsigned charLen = 0;
    bool errors = false;

    const unsigned char * s = (const unsigned char *)str;
    const unsigned char * e = (const unsigned char *)str + length;

    while (s < e) {
        ++charLen;
        if (JS_LIKELY(!(*s & 0x80))) { // Plain old ASCII - we love thee!
            ++s;
        } else {
            if (JS_LIKELY(utf8CodePointLength(*s) <= e - s)) {
                uint32_t cp;
                const unsigned char * ssav = s;
                s = utf8Decode(s, &cp);
                if (JS_UNLIKELY(cp == UNICODE_ERROR)) {
                    errors = true;

                    // Find the start of the next valid character
                    while (s < e && !utf8IsStartByte(*s))
                        ++s;
                    actualLength = actualLength - (unsigned)(s - ssav) + UNI_REPLACEMENT_LENGTH;
                }
            } else {
                // Uh-oh!
                errors = true;
                actualLength = actualLength - (unsigned)(e - s) + UNI_REPLACEMENT_LENGTH;
                break;
            }
        }
    }

    StringPrim * res = makeEmpty(caller, actualLength);

    if (JS_LIKELY(!errors)) {
        assert(actualLength == length);
        memcpy(res->_str, str, actualLength);
    } else {
        // Now painfully do the same thing, but this time setting the actual values
        unsigned char * d = res->_str;
        s = (const unsigned char *)str;

        while (s < e) {
            if (JS_LIKELY(!(*s & 0x80))) { // Plain old ASCII - we love thee!
                *d++ = *s++;
            } else {
                if (JS_LIKELY(utf8CodePointLength(*s) <= e - s)) {
                    uint32_t cp;
                    const unsigned char * ssav = s;
                    s = utf8Decode(s, &cp);
                    if (JS_LIKELY(cp != UNICODE_ERROR)) {
                        do
                            *d++ = *ssav++;
                        while (ssav < s);
                    } else {
                        // Find the start of the next valid character
                        while (s < e && !utf8IsStartByte(*s))
                            ++s;
                        *d++ = UTF8_REPLACEMENT_CHAR_0;
                        *d++ = UTF8_REPLACEMENT_CHAR_1;
                        *d++ = UTF8_REPLACEMENT_CHAR_2;
                    }
                } else {
                    // Uh-oh!
                    *d++ = UTF8_REPLACEMENT_CHAR_0;
                    *d++ = UTF8_REPLACEMENT_CHAR_1;
                    *d++ = UTF8_REPLACEMENT_CHAR_2;
                    break;
                }
            }
        }

        assert(d - res->_str == actualLength);
    }

    res->init(charLen);
    return res;
}

const unsigned char * StringPrim::charPos (uint32_t index, bool * secondSurrogate) const
{
    if (JS_UNLIKELY(index >= this->charLength)) {
        *secondSurrogate = false;
        return this->_str + this->byteLength;
    }

    unsigned lindex, cpLen;
    const unsigned char * lpos;

    lpos = this->_str + this->lastPos;
    lindex = this->lastIndex;

    if (index == lindex) {
        // nothing
    } else {
        if (index < lindex) {
            lpos = this->_str;
            lindex = 0;
        }
        cpLen = 0;
        while (lindex < index) {
            cpLen = utf8CodePointLength(*lpos);
            lpos += cpLen;
            lindex += (cpLen >> 2) + 1; // same as cpLen < 4 ? 1 : 2
        }

        if (index < lindex) { // Did we skip over index? That means we hit the second part of a surrogate pair
            // Get back to the beginning of the codepoint
            lpos -= cpLen;
            lindex -= (cpLen >> 2)+1;
            this->lastPos = lpos - this->_str;
            this->lastIndex = lindex;

            *secondSurrogate = true;
            return lpos;
        }

        this->lastPos = lpos - this->_str;
        this->lastIndex = lindex;
    }

    *secondSurrogate = false;
    return lpos;
}

uint32_t StringPrim::byteOffsetToUTF16Index (unsigned offset) const
{
    if (offset >= this->byteLength)
        return this->charLength;

    unsigned lindex, cpLen;
    const unsigned char * lpos;
    const unsigned char * pos;

    lpos = this->_str + this->lastPos;
    pos = this->_str + offset;
    lindex = this->lastIndex;

    if (pos == lpos) {
        // nothing
    } else {
        if (pos < lpos) {
            lpos = this->_str;
            lindex = 0;
        }
        while (lpos < pos) {
            cpLen = utf8CodePointLength(*lpos);
            lpos += cpLen;
            lindex += (cpLen >> 2) + 1; // same as cpLen < 4 ? 1 : 2
        }

        this->lastPos = lpos - this->_str;
        this->lastIndex = lindex;
    }

    return lindex;
}

TaggedValue StringPrim::charCodeAt (uint32_t index) const
{
    if (JS_UNLIKELY(index >= this->charLength))
        return makeNumberValue(NAN);

    bool secondSurrogate;
    const unsigned char * lpos = charPos(index, &secondSurrogate);

    uint32_t cp = utf8DecodeFast(lpos);

    if (JS_LIKELY(!secondSurrogate)) {
        if (JS_LIKELY(cp <= 0xFFFF))
            return makeNumberValue(cp);
        else // first part of the surrogate pair (high surrogate)
            return makeNumberValue((((cp - 0x10000) >> 10) & 0x3FF) + 0xD800);
    } else {
        // synthesize the second surrogate
        assert(cp > 0xFFFF);
        return makeNumberValue((cp & 0x3FF) + 0xDC00);
    }
}

TaggedValue StringPrim::charAt (StackFrame * caller, uint32_t index) const
{
    if (JS_UNLIKELY(index >= this->charLength))
        return JS_UNDEFINED_VALUE;

    bool secondSurrogate;
    const unsigned char * lpos = charPos(index, &secondSurrogate);

    if (JS_LIKELY(!secondSurrogate)) {
        unsigned char ch0 = *lpos;
        unsigned cpLen = utf8CodePointLength(ch0);

        if (cpLen > 3) // First part of a surrogate pair?
            return makeStringValue(JS_GET_RUNTIME(caller)->permStrUnicodeReplacementChar);

        if (cpLen == 1/*&& ch0 < Runtime::CACHED_CHARS*/) // A good old ASCII character?
            return makeStringValue(JS_GET_RUNTIME(caller)->asciiChars[ch0]);

        return makeStringValue(StringPrim::makeFromValid(caller, (const char *)lpos, cpLen, 1));
    } else {
        return makeStringValue(JS_GET_RUNTIME(caller)->permStrUnicodeReplacementChar);
    }
}

TaggedValue StringPrim::substring (StackFrame * caller, uint32_t from, uint32_t to) const
{
    // clamp "to"
    if (JS_UNLIKELY(to > this->charLength))
        to = this->charLength;

    // check for an empty string
    if (JS_UNLIKELY(from >= to))
        return makeStringValue(JS_GET_RUNTIME(caller)->permStrEmpty);

    // only a single character requested?
    if (JS_UNLIKELY(to == from + 1))
        return charAt(caller, from);

    // The whole string?
    if (JS_UNLIKELY(from == 0 && to == this->charLength))
        return makeStringValue(this);

    bool secondSurrogate;
    const unsigned char * fromPos = charPos(from, &secondSurrogate);
    unsigned fromAdj;
    unsigned cpLen = utf8CodePointLength(*fromPos);

    if (JS_UNLIKELY(secondSurrogate)) { // If we hit the second part of a synthesized secondSurrogate pair, skip whole the utf-8 character
        fromPos += cpLen;
        fromAdj = 3; // we will have to prepent UNICODE_REPLACEMENT_CHARACTER
    } else {
        fromAdj = 0;
    }

    // Note that "toPos" starts as being inclusive, but after the check for secondSurrogate we adjust it to be exclusive again
    const unsigned char * toPos = charPos(to - 1, &secondSurrogate);
    unsigned toAdj;
    cpLen = utf8CodePointLength(*toPos);

    if (JS_UNLIKELY(!secondSurrogate && cpLen > 3)) { // We hit the first part of a surrogate pair
        toAdj = 3;  // we will have to append UNICODE_REPLACEMENT_CHARACTER
    } else {
        toPos += cpLen; // adjust toPos to be exclusive again
        toAdj = 0;
    }

    unsigned length = (toPos - fromPos) + fromAdj + toAdj;

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":StringPrim::substring()", __LINE__);
    StringPrim * str;
    frame.locals[0] = makeStringValue(str = StringPrim::makeEmpty(&frame, length));

    if (fromAdj)
        utf8Encode(str->_str, UNICODE_REPLACEMENT_CHARACTER);
    memcpy(str->_str + fromAdj, fromPos, toPos - fromPos);
    if (toAdj)
        utf8Encode(str->_str + length - toAdj, UNICODE_REPLACEMENT_CHARACTER);

    str->init(to - from);

    return makeStringValue(str);
}

TaggedValue StringPrim::byteSubstring (StackFrame * caller, uint32_t from, uint32_t to) const
{
    // clamp "to"
    if (JS_UNLIKELY(to > this->byteLength))
        to = this->byteLength;

    // check for an empty string
    if (JS_UNLIKELY(from >= to))
        return makeStringValue(JS_GET_RUNTIME(caller)->permStrEmpty);

    // The whole string?
    if (JS_UNLIKELY(from == 0 && to == this->charLength))
        return makeStringValue(this);

    const unsigned char * fromPos = this->_str + from;

    // only a single character requested?
    if (JS_UNLIKELY(to == from + 1 && *fromPos < Runtime::CACHED_CHARS))
        return makeStringValue(JS_GET_RUNTIME(caller)->asciiChars[*fromPos]);

    unsigned length = to - from;

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":StringPrim::byteSubstring()", __LINE__);
    StringPrim * str;
    frame.locals[0] = makeStringValue(str = StringPrim::makeEmpty(&frame, length));
    memcpy(str->_str, fromPos, length);
    str->init();
    return makeStringValue(str);
}


unsigned StringPrim::lengthInUTF16Units (const unsigned char * from, const unsigned char * to)
{
    unsigned length = 0;

    while (from < to) {
        unsigned cpLen = utf8CodePointLength(*from);
        from += cpLen;
        length += (cpLen >> 2) + 1; // same as cpLen < 4 ? 1 : 2
    }

    return length;
}

bool Box::mark (IMark * marker, unsigned markBit) const
{
    return super::mark(marker, markBit) && markValue(marker, markBit, this->value);
}

TaggedValue Box::defaultValue (StackFrame *, ValueTag)
{
    return this->value;
}

InternalClass Number::getInternalClass () const
{
    return ICLS_NUMBER;
}

InternalClass Boolean::getInternalClass () const
{
    return ICLS_BOOLEAN;
}

InternalClass String::getInternalClass () const
{
    return ICLS_STRING;
}

bool String::mark (IMark * marker, unsigned markBit) const
{
    return super::mark(marker, markBit) && markValue(marker, markBit, this->value);
}

TaggedValue String::defaultValue (StackFrame *, ValueTag)
{
    return this->value;
}

uint32_t String::getIndexedLength () const
{
    return this->getStrPrim()->charLength;
}

bool String::hasIndex (uint32_t index) const
{
    return index < getStrPrim()->charLength;
}

TaggedValue String::getAtIndex (StackFrame * caller, uint32_t index) const
{
    return getStrPrim()->charAt(caller, index);
}

bool String::setAtIndex (StackFrame *,uint32_t index, TaggedValue value)
{
    return false;
}

bool String::deleteAtIndex (uint32_t index)
{
    return false;
}

InternalClass Error::getInternalClass () const
{
    return ICLS_ERROR;
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

TaggedValue emptyFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    return JS_UNDEFINED_VALUE;
}

TaggedValue objectFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    TaggedValue value = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (value.tag == VT_UNDEFINED || value.tag == VT_NULL)
        return makeObjectValue(newInit<Object>(caller, JS_GET_RUNTIME(caller)->objectPrototype));
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
        ArrayBase * argSlots = newInit<ArrayBase>(&frame, &frame.locals[1], JS_GET_RUNTIME(&frame)->arrayPrototype);
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

    newInit2<BoundPrototype>(&frame, &frame.locals[1], JS_GET_RUNTIME(&frame)->objectPrototype, target);
    boundFunc->definePrototype(&frame, frame.locals[1].raw.oval, 0);

    return frame.locals[0];
}

TaggedValue stringFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    return argc > 1 ? toString(caller, argv[1]) : makeStringValue(JS_GET_RUNTIME(caller)->permStrEmpty);
}
TaggedValue stringConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    String * str = (String *)argv[0].raw.oval;
    str->setValue(stringFunction(caller, NULL, argc, argv));

    str->defineOwnProperty(caller, JS_GET_RUNTIME(caller)->permStrLength, PROP_NONE,
        makeNumberValue(str->getStrPrim()->charLength)
    );

    return JS_UNDEFINED_VALUE;
}

TaggedValue stringCharCodeAt (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringCharCodeAt", __LINE__);
    TaggedValue pos = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (argv[0].tag == VT_UNDEFINED || argv[0].tag == VT_NULL)
        throwTypeError(&frame, "'this' is not coercible to string");

    frame.locals[0] = toString(&frame, argv[0]);
    const StringPrim * sprim = frame.locals[0].raw.sval;

    // We need to convert pos to integer, which is not necessarily fast as we need to support cases
    // like infinity, etc. So, first we check for the fastest case and if not, go real slow
    uint32_t upos;
    if (JS_LIKELY(IS_FAST_UINT32(pos, upos)))
        return sprim->charCodeAt(upos);

    double fpos = toInteger(&frame, pos);
    if (JS_UNLIKELY(fpos < 0 || fpos >= sprim->charLength))
        return makeNumberValue(NAN);
    else
        return sprim->charCodeAt((uint32_t)fpos);
}

TaggedValue stringCharAt (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringCharAt", __LINE__);
    TaggedValue pos = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    if (argv[0].tag == VT_UNDEFINED || argv[0].tag == VT_NULL)
        throwTypeError(&frame, "'this' is not coercible to string");

    frame.locals[0] = toString(&frame, argv[0]);
    const StringPrim * sprim = frame.locals[0].raw.sval;

    // We need to convert pos to integer, which is not necessarily fast as we need to support cases
    // like infinity, etc. So, first we check for the fastest case and if not, go real slow
    uint32_t upos;
    if (JS_LIKELY(IS_FAST_UINT32(pos, upos)))
        return sprim->charAt(&frame, upos);

    double fpos = toInteger(&frame, pos);
    if (JS_UNLIKELY(fpos < 0 || fpos >= sprim->charLength))
        return makeNumberValue(NAN);
    else
        return sprim->charAt(&frame, (uint32_t)fpos);
}

TaggedValue stringSlice (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringSlice()", __LINE__);
    TaggedValue start = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    TaggedValue end = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;

    if (argv[0].tag == VT_UNDEFINED || argv[0].tag == VT_NULL)
        throwTypeError(&frame, "'this' is not coercible to string");

    // Convert 'this' to string
    frame.locals[0] = toString(&frame, argv[0]);
    const StringPrim * sprim = frame.locals[0].raw.sval;

    // We need to convert start and end to integer, which is not necessarily fast as we need to support cases
    // like infinity, etc. So, first we check for the fastest case and if not, go real slow
    int32_t ilen; // length of sprim, if it fits in int32_t
    int32_t intStart, intEnd;
    if (JS_LIKELY(IS_FAST_INT32(start, intStart) &&  // is "start" an int32_t value?
                  (ilen = sprim->charLength) >= 0))  // is the string length an int32_t value?
    {
        if (IS_FAST_INT32(end, intEnd)) {
            // nothing
        } else if (end.tag == VT_UNDEFINED) {
            intEnd = ilen;
        } else {
            goto slowPath;
        }

        // Correct intStart
        if (intStart < 0) {
            intStart += ilen;
            if (JS_UNLIKELY(intStart < 0))
                intStart = 0;
        }
        // We don't need to do the following since StringPrim::substring() already does the clamping
        //else if (intStart > ilen) {
        //    intStart = ilen;
        //}

        // Correct intEnd
        if (intEnd < 0) {
            intEnd += ilen;
            if (JS_UNLIKELY(intEnd < 0))
                intEnd = 0;
        }
        // We don't need to do the following since StringPrim::substring() already does the clamping
        //else if (intEnd > ilen) {
        //    intEnd = ilen;
        //}

        // We don't need to do the following since StringPrim::substring() already checks
        //if (JS_UNLIKELY(intEnd <= intStart))
        //    return makeStringValue(JS_GET_RUNTIME(&frame)->permStrEmpty);

        return sprim->substring(&frame, (uint32_t)intStart, (uint32_t)intEnd);
    }

slowPath:
    double len = sprim->charLength;
    double from = toInteger(&frame, start);
    double to = end.tag != VT_UNDEFINED ? toInteger(&frame, end) : len;

    if (from < 0) {
        from += len;
        if (JS_UNLIKELY(from < 0))
            from = 0;
    } else if (JS_UNLIKELY(from > len)) {
        from = len;
    }

    if (to < 0) {
        to += len;
        if (JS_UNLIKELY(to < 0))
            to = 0;
    } else if (JS_UNLIKELY(to > len)) {
        to = len;
    }

    return sprim->substring(&frame, (uint32_t)from, (uint32_t)to);
}

TaggedValue stringSubstring (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringSlice()", __LINE__);
    TaggedValue start = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    TaggedValue end = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;

    if (argv[0].tag == VT_UNDEFINED || argv[0].tag == VT_NULL)
        throwTypeError(&frame, "'this' is not coercible to string");

    // Convert 'this' to string
    frame.locals[0] = toString(&frame, argv[0]);
    const StringPrim * sprim = frame.locals[0].raw.sval;

    // We need to convert start and end to integer, which is not necessarily fast as we need to support cases
    // like infinity, etc. So, first we check for the fastest case and if not, go real slow
    int32_t ilen; // length of sprim, if it fits in int32_t
    int32_t intStart, intEnd;
    if (JS_LIKELY(IS_FAST_INT32(start, intStart) &&  // is "start" an int32_t value?
                  (ilen = sprim->charLength) >= 0))  // is the string length an int32_t value?
    {
        if (IS_FAST_INT32(end, intEnd)) {
            // nothing
        } else if (end.tag == VT_UNDEFINED) {
            intEnd = ilen;
        } else {
            goto slowPath;
        }

        // Correct intStart
        if (JS_UNLIKELY(intStart < 0))
            intStart = 0;
        else if (JS_UNLIKELY(intStart > ilen))
            intStart = ilen;

        // Correct intEnd
        if (JS_UNLIKELY(intEnd < 0))
            intEnd = 0;
        else if (JS_UNLIKELY(intEnd > ilen))
            intEnd = ilen;

        if (JS_UNLIKELY(intStart > intEnd))
            std::swap(intStart, intEnd);

        return sprim->substring(&frame, (uint32_t)intStart, (uint32_t)intEnd);
    }

slowPath:
    double len = sprim->charLength;
    double from = toInteger(&frame, start);
    double to = end.tag != VT_UNDEFINED ? toInteger(&frame, end) : len;

    if (JS_UNLIKELY(from < 0))
        from = 0;
    else if (JS_UNLIKELY(from > len))
        from = len;

    if (JS_UNLIKELY(to < 0))
        to = 0;
    else if (JS_UNLIKELY(to > len))
        to = len;

    if (JS_UNLIKELY(from > to))
        std::swap(from, to);

    return sprim->substring(&frame, (uint32_t)from, (uint32_t)to);
}

TaggedValue stringSubstr (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringSlice()", __LINE__);
    TaggedValue start = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    TaggedValue length = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;

    if (argv[0].tag == VT_UNDEFINED || argv[0].tag == VT_NULL)
        throwTypeError(&frame, "'this' is not coercible to string");

    // Convert 'this' to string
    frame.locals[0] = toString(&frame, argv[0]);
    const StringPrim * sprim = frame.locals[0].raw.sval;

    // We need to convert start and end to integer, which is not necessarily fast as we need to support cases
    // like infinity, etc. So, first we check for the fastest case and if not, go real slow
    int32_t ilen; // length of sprim, if it fits in int32_t
    int32_t intStart, intLength;
    if (JS_LIKELY(IS_FAST_INT32(start, intStart) &&  // is "start" an int32_t value?
                  (ilen = sprim->charLength) >= 0))  // is the string length an int32_t value?
    {
        if (IS_FAST_INT32(length, intLength)) {
            // nothing
        } else if (length.tag == VT_UNDEFINED) {
            intLength = ilen;
        } else {
            goto slowPath;
        }

        // Correct intStart
        if (JS_UNLIKELY(intStart < 0)) {
            intStart += ilen;
            if (JS_UNLIKELY(intStart < 0))
                intStart = 0;
        }

        // Correct intLength
        intLength = std::min(std::max(intLength, 0), ilen - intStart);
        if (JS_UNLIKELY(intLength <= 0))
            return makeStringValue(JS_GET_RUNTIME(&frame)->permStrEmpty);

        return sprim->substring(&frame, (uint32_t)intStart, (uint32_t)intStart + intLength);
    }

    slowPath:
    double len = sprim->charLength;
    double fstart = toInteger(&frame, start);
    double flength = length.tag != VT_UNDEFINED ? toInteger(&frame, length) : len;

    if (JS_UNLIKELY(fstart < 0)) {
        fstart += len;
        if (JS_UNLIKELY(fstart < 0))
            fstart = 0;
    }

    flength = std::min(std::max(flength, 0.0), len - fstart);
    if (JS_UNLIKELY(flength) <= 0)
        return makeStringValue(JS_GET_RUNTIME(&frame)->permStrEmpty);

    return sprim->substring(&frame, (uint32_t)fstart, (uint32_t)(fstart + flength));
}

TaggedValue stringFromCharCode (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    unsigned inputCharCount = argc - 1;
    uint32_t buf[16];
    std::unique_ptr<uint32_t[]> heapBuf;
    uint32_t * pbuf;

    if (JS_UNLIKELY(inputCharCount > 16))
        heapBuf.reset(pbuf = new uint32_t[inputCharCount]);
    else
        pbuf = buf;

    unsigned utf32count = 0;
    unsigned utf8ByteLen = 0;
    unsigned utf16count = 0;

    for ( unsigned i = 0; i < inputCharCount; ++i ) {
        uint16_t ch = (uint16_t)toUint32(caller, argv[i+1]);
        if (JS_UNLIKELY(ch >= 0xD800 && ch < 0xDC00)) { // first surrogate
            ++i;
            if (JS_UNLIKELY(i == inputCharCount)) {
                pbuf[utf32count++] = UNICODE_REPLACEMENT_CHARACTER;
                utf8ByteLen += 3; // the length of utf-8 encoded UNICODE_REPLACEMENT_CHARACTER
                ++utf16count;
                break;
            }
            uint16_t ch2 = (uint16_t)toUint32(caller, argv[i+1]);
            if (JS_UNLIKELY(!(ch2 >= 0xDC00 && ch2 <= 0xDFFF))) {
                pbuf[utf32count++] = UNICODE_REPLACEMENT_CHARACTER;
                utf8ByteLen += 3; // the length of utf-8 encoded UNICODE_REPLACEMENT_CHARACTER
                ++utf16count;
                --i;
            } else {
                uint32_t t = (((uint32_t)ch - 0xD800) << 10) + 0x10000 + ch2 - 0xDC00;
                pbuf[utf32count++] = t;
                utf8ByteLen += utf8EncodedLength(t);
                utf16count += 2;
            }
        } else if (JS_UNLIKELY(ch >= 0xDC00 && ch <= 0xDFFF)) { // invalid second surrogate!
            pbuf[utf32count++] = UNICODE_REPLACEMENT_CHARACTER;
            utf8ByteLen += 3; // the length of utf-8 encoded UNICODE_REPLACEMENT_CHARACTER
            ++utf16count;
        } else {
            pbuf[utf32count++] = ch;
            utf8ByteLen += utf8EncodedLength(ch);
            ++utf16count;
        }
    }

    if (JS_UNLIKELY(utf32count == 0))
        return makeStringValue(JS_GET_RUNTIME(caller)->permStrEmpty);
    if (JS_LIKELY(utf32count == 1 && pbuf[0] < Runtime::CACHED_CHARS))
        return makeStringValue(JS_GET_RUNTIME(caller)->asciiChars[pbuf[0]]);

    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":stringFromCharCode()", __LINE__);
    StringPrim * str;
    frame.locals[0] = makeStringValue(str = StringPrim::makeEmpty(&frame, utf8ByteLen));

    // Encode the values as utf-8
    unsigned char * dest = str->_str;
    for ( unsigned i = 0; i < utf32count; ++i )
        dest += utf8Encode(dest, pbuf[i]);

    str->init(utf16count);

    return frame.locals[0];
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
    Array * array = newInit<Array>(caller, JS_GET_RUNTIME(caller)->arrayPrototype);
    arrayInit(array, argc, argv);
    return makeObjectValue(array);
}
TaggedValue arrayConstructor (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    arrayInit((Array *)argv[0].raw.oval, argc, argv);
    return JS_UNDEFINED_VALUE;
}

class GenericSortCB : public IExchangeSortCB
{
    Object * obj;
    Function * compareFn;
public:
    GenericSortCB (Object * obj, Function * compareFn) :
        obj(obj), compareFn(compareFn)
    {}

    virtual void swap (StackFrame * caller, uint32_t a, uint32_t b)
    {
        StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":GenericSortCB::swap()", __LINE__);
        TaggedValue propA = makeNumberValue(a);
        TaggedValue propB = makeNumberValue(b);

        if (JS_UNLIKELY(!obj->hasComputed(&frame, propA))) {
            if (obj->hasComputed(&frame, propB)) {
                frame.locals[1] = obj->getComputed(&frame, propB);
                obj->putComputed(&frame, propA, frame.locals[1]);
                obj->deleteComputed(&frame, propB);
            }
            return;
        } else {
            if (JS_UNLIKELY(!obj->hasComputed(&frame, propB))) {
                frame.locals[0] = obj->getComputed(&frame, propA);
                obj->putComputed(&frame, propB, frame.locals[0]);
                obj->deleteComputed(&frame, propA);
                return;
            }
        }

        frame.locals[0] = obj->getComputed(&frame, propA);
        frame.locals[1] = obj->getComputed(&frame, propB);
        obj->putComputed(&frame, propB, frame.locals[0]);
        obj->putComputed(&frame, propA, frame.locals[1]);
    }

    virtual bool less (StackFrame * caller, uint32_t a, uint32_t b)
    {
        TaggedValue propA = makeNumberValue(a);
        TaggedValue propB = makeNumberValue(b);

        if (!obj->hasComputed(caller, propA)) {
            return false;
        } else {
            if (!obj->hasComputed(caller, propB))
                return true;
        }

        StackFrameN<0,4,0> frame(caller, NULL, __FILE__ ":GenericSortCB::less()", __LINE__);
        frame.locals[1] = obj->getComputed(&frame, propA);
        frame.locals[2] = obj->getComputed(&frame, propB);

        if (frame.locals[1].tag == VT_UNDEFINED) {
            return false;
        } else {
            if (frame.locals[2].tag == VT_UNDEFINED)
                return true;
        }

        if (compareFn) {
            frame.locals[3] = compareFn->call(&frame, 3, &frame.locals[0]);
            return js::toNumber(&frame, frame.locals[3]) < 0;
        } else {
            frame.locals[1] = toString(&frame, frame.locals[1]);
            frame.locals[2] = toString(&frame, frame.locals[2]);

            return frame.locals[1].raw.sval != frame.locals[2].raw.sval &&
                   ::strcmp(frame.locals[1].raw.sval->getStr(), frame.locals[2].raw.sval->getStr()) < 0;
        }
    }
};

class IndexedObjectSortCB : public IExchangeSortCB
{
    IndexedObject * obj;
    Function * compareFn;
public:
    IndexedObjectSortCB (IndexedObject * obj, Function * compareFn) :
        obj(obj), compareFn(compareFn)
    {}

    virtual void swap (StackFrame * caller, uint32_t a, uint32_t b)
    {
        StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":GenericSortCB::swap()", __LINE__);

        if (JS_UNLIKELY(!obj->hasIndex(a))) {
            if (obj->hasIndex(b)) {
                frame.locals[1] = obj->getAtIndex(&frame, b);
                obj->setAtIndex(&frame, a, frame.locals[1]);
                obj->deleteAtIndex(b);
            }
            return;
        } else {
            if (JS_UNLIKELY(!obj->hasIndex(b))) {
                frame.locals[0] = obj->getAtIndex(&frame, a);
                obj->setAtIndex(&frame, b, frame.locals[0]);
                obj->deleteAtIndex(a);
                return;
            }
        }

        frame.locals[0] = obj->getAtIndex(&frame, a);
        frame.locals[1] = obj->getAtIndex(&frame, b);
        obj->setAtIndex(&frame, b, frame.locals[0]);
        obj->setAtIndex(&frame, a, frame.locals[1]);
    }

    virtual bool less (StackFrame * caller, uint32_t a, uint32_t b)
    {
        if (!obj->hasIndex(a)) {
            return false;
        } else {
            if (!obj->hasIndex(b))
                return true;
        }

        StackFrameN<0,4,0> frame(caller, NULL, __FILE__ ":GenericSortCB::less()", __LINE__);
        frame.locals[1] = obj->getAtIndex(&frame, a);
        frame.locals[2] = obj->getAtIndex(&frame, b);

        if (frame.locals[1].tag == VT_UNDEFINED) {
            return false;
        } else {
            if (frame.locals[2].tag == VT_UNDEFINED)
                return true;
        }

        if (compareFn) {
            frame.locals[3] = compareFn->call(&frame, 3, &frame.locals[0]);
            return js::toNumber(&frame, frame.locals[3]) < 0;
        } else {
            frame.locals[1] = toString(&frame, frame.locals[1]);
            frame.locals[2] = toString(&frame, frame.locals[2]);

            return frame.locals[1].raw.sval != frame.locals[2].raw.sval &&
                   ::strcmp(frame.locals[1].raw.sval->getStr(), frame.locals[2].raw.sval->getStr()) < 0;
        }
    }
};

class ArraySortCB : public IExchangeSortCB
{
    ArrayBase * obj;
    Function * compareFn;
public:
    ArraySortCB (ArrayBase * obj, Function * compareFn) :
        obj(obj), compareFn(compareFn)
    {}

    virtual void swap (StackFrame * caller, uint32_t a, uint32_t b)
    {
        TaggedValue * pa = &obj->elems[a];
        TaggedValue * pb = &obj->elems[b];

        TaggedValue tmp = *pa;
        *pa = *pb;
        *pb = tmp;
    }

    virtual bool less (StackFrame * caller, uint32_t a, uint32_t b)
    {
        TaggedValue * pa = &obj->elems[a];
        TaggedValue * pb = &obj->elems[b];

        if (pa->tag == VT_ARRAY_HOLE) {
            return false;
        } else {
            if (pb->tag == VT_ARRAY_HOLE)
                return true;
        }

        if (pa->tag == VT_UNDEFINED) {
            return false;
        } else {
            if (pb->tag == VT_UNDEFINED)
                return true;
        }

        StackFrameN<0,4,0> frame(caller, NULL, __FILE__ ":ArraySortCB::less()", __LINE__);

        if (compareFn) {
            frame.locals[1] = *pa;
            frame.locals[2] = *pb;
            frame.locals[3] = compareFn->call(&frame, 3, &frame.locals[0]);
            return js::toNumber(&frame, frame.locals[3]) < 0;
        } else {
            frame.locals[1] = toString(&frame, *pa);
            frame.locals[2] = toString(&frame, *pb);

            return frame.locals[1].raw.sval != frame.locals[2].raw.sval &&
                   ::strcmp(frame.locals[1].raw.sval->getStr(), frame.locals[2].raw.sval->getStr()) < 0;
        }
    }
};

class ArraySortCBAlg
{
    ArrayBase * obj;
    Function * compareFn;
public:
    ArraySortCBAlg (ArrayBase * obj, Function * compareFn) :
        obj(obj), compareFn(compareFn)
    {}

    void swap (StackFrame * caller, TaggedValue * pa, TaggedValue * pb) const
    {
        TaggedValue tmp = *pa;
        *pa = *pb;
        *pb = tmp;
    }

    bool less (StackFrame * caller, TaggedValue * pa, TaggedValue * pb) const
    {
        if (pa->tag == VT_ARRAY_HOLE) {
            return false;
        } else {
            if (pb->tag == VT_ARRAY_HOLE)
                return true;
        }

        if (pa->tag == VT_UNDEFINED) {
            return false;
        } else {
            if (pb->tag == VT_UNDEFINED)
                return true;
        }

        StackFrameN<0,4,0> frame(caller, NULL, __FILE__ ":ArraySortCB::less()", __LINE__);

        if (compareFn) {
            frame.locals[1] = *pa;
            frame.locals[2] = *pb;
            frame.locals[3] = compareFn->call(&frame, 3, &frame.locals[0]);
            return js::toNumber(&frame, frame.locals[3]) < 0;
        } else {
            frame.locals[1] = toString(&frame, *pa);
            frame.locals[2] = toString(&frame, *pb);

            return frame.locals[1].raw.sval != frame.locals[2].raw.sval &&
                   ::strcmp(frame.locals[1].raw.sval->getStr(), frame.locals[2].raw.sval->getStr()) < 0;
        }
    }
};

TaggedValue arraySort (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":arraySort()", __LINE__);
    Function * compareFn;

    if (argc > 1) {
        if (!(compareFn = isFunction(argv[1])))
            throwTypeError(&frame, "'comparefn' is not callable");
    } else {
        compareFn = NULL;
    }

    // obj = toObject(this)
    frame.locals[0] = JS_LIKELY(isValueTagObject(argv[0].tag)) ? *argv : js::makeObjectValue(toObject(&frame, argv[0]));
    Object * obj = frame.locals[0].raw.oval;
    uint32_t length;
    IndexedObject * io;
    ArrayBase * array = NULL;

    io = dynamic_cast<IndexedObject*>(obj);
    if (JS_LIKELY(io != NULL && (io->flags & OF_INDEX_PROPERTIES) == 0)) {
        length = io->getIndexedLength();
        // Also check if it is an array for even better performance
        array = dynamic_cast<Array *>(io);
    } else {
        // A very unlikely and very slow case. So, we copy it into an array
        length = js::toUint32(&frame, js::get(caller, frame.locals[0], JS_GET_RUNTIME(&frame)->permStrLength));
        if (!length)
            return frame.locals[0];

        io = array = newInit<Array>(&frame, &frame.locals[1], JS_GET_RUNTIME(&frame)->arrayPrototype);
        array->setLength(length);
        TaggedValue * p = &array->elems[0];
        for ( uint32_t i = 0; i < length; ++i, ++p ) {
            TaggedValue ip = makeNumberValue(i);
            if (obj->hasComputed(&frame, ip))
                *p = obj->getComputed(&frame, ip);
        }
    }

    if (array) {
        ArraySortCB cb(array, compareFn);
        quickSort(&frame, &cb, 0, length);
    } else {
        IndexedObjectSortCB cb(io, compareFn);
        quickSort(&frame, &cb, 0, length);
    }

    if (io != obj) { // Copy back the temporary array we created
        assert(array);
        const TaggedValue * p = &array->elems[0];
        for ( uint32_t i = 0; i < length; ++i, ++p ) {
            if (p->tag != VT_ARRAY_HOLE)
                obj->putComputed(&frame, makeNumberValue(i), *p);
            else
                obj->deleteComputed(&frame, makeNumberValue(i));
        }
    }

    return frame.locals[0];
}

TaggedValue errorFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":errorFunction" , __LINE__);
    TaggedValue thisp = argv[0];

    if (isValueTagObject(thisp.tag))
        frame.locals[0] = thisp;
    else
        frame.locals[0] = makeObjectValue(JS_GET_RUNTIME(&frame)->errorPrototype->createDescendant(&frame));

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
    TaggedValue thisp = argv[0];

    if (isValueTagObject(thisp.tag))
        frame.locals[0] = thisp;
    else
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


Runtime::Runtime (bool strictMode, int argc, const char ** argv)
{
    diagFlags = 0;
    this->strictMode = strictMode;
    this->argc = argc;
    this->argv = argv;
    env = NULL;
    markBit = 0;
    head.header = 0;
    tail = &head;
    allocatedSize = 0;
    gcThreshold = 100;

    g_runtime = this;
    parseDiagEnvironment();

    // Note: we need to be extra careful to store allocated values where the FC can trace them.
    StackFrameN<0, 2, 0> frame(NULL, NULL, __FILE__ ":Runtime::Runtime()", __LINE__);

    // Perm strings
    permStrEmpty = internString(&frame, true, "");
    permStrUndefined = internString(&frame, true, "undefined");
    permStrNull = internString(&frame, true, "null");
    permStrTrue = internString(&frame, true, "true");
    permStrFalse = internString(&frame, true, "false");
    permStrNaN = internString(&frame, true, "NaN");
    permStrInfinity = internString(&frame, true, "Infinity");
    permStrMinusInfinity = internString(&frame, true, "-Infinity");
    permStrPrototype = internString(&frame, true, "prototype");
    permStrConstructor = internString(&frame, true, "constructor");
    permStrLength = internString(&frame, true, "length");
    permStrName = internString(&frame, true, "name");
    permStrArguments = internString(&frame, true, "arguments");
    permStrCaller = internString(&frame, true, "caller");
    permStrCallee = internString(&frame, true, "callee");
    permStrObject = internString(&frame, true, "object");
    permStrBoolean = internString(&frame, true, "boolean");
    permStrNumber = internString(&frame, true, "number");
    permStrString = internString(&frame, true, "string");
    permStrFunction = internString(&frame, true, "function");
    permStrToString = internString(&frame, true, "toString");
    permStrValueOf = internString(&frame, true, "valueOf");
    permStrMessage = internString(&frame, true, "message");
    {
        char buf[8];
        unsigned length;
        length = utf8Encode((unsigned char *)buf, UNICODE_REPLACEMENT_CHARACTER);
        permStrUnicodeReplacementChar = internString(&frame, true, buf, length);
    }

    // Initialize the pre-allocated ASCII chars
    //
    for ( int i = 0; i < CACHED_CHARS; ++i ) {
        char ch = (char)i;
        this->asciiChars[i] = internString(&frame, true, &ch, 1);
    }

    // Global env
    env = Env::make(&frame, NULL, 40);

    // strictThrowerAccessor: the functions will be initialized later when the object system is up
    env->vars[16] = strictThrowerAccessor = makePropertyAccessorValue(new(&frame) PropertyAccessor(NULL, NULL));

    // Object.prototype
    //
    objectPrototype = newInit<Object>(&frame, &env->vars[0], NULL);

    // Function.prototype
    //
    functionPrototype = new(&frame) FunctionCreator(objectPrototype);
    env->vars[2] = makeObjectValue(functionPrototype);
    functionPrototype->init(&frame, env, emptyFunc, emptyFunc, internString(&frame, true, "functionPrototype"), 0);

    // strictThrowerAccessor: Used as a "poison pill" when accessing forbidden properties
    {
        Function * strictThrowerFunction = new(&frame) Function(functionPrototype);
        frame.locals[0] = makeObjectValue(strictThrowerFunction);
        strictThrowerFunction->init(&frame, env, strictThrower, strictThrower, NULL, 0);

        ((PropertyAccessor *)strictThrowerAccessor.raw.mval)->get = strictThrowerFunction;
        ((PropertyAccessor *)strictThrowerAccessor.raw.mval)->set = strictThrowerFunction;
    }

    // arrayLengthAccessor
    {
        frame.locals[0] = newFunction(&frame, NULL, permStrLength, 0, Array::lengthGetter);
        frame.locals[1] = newFunction(&frame, NULL, permStrLength, 1, Array::lengthSetter);
        env->vars[17] = arrayLengthAccessor = makeMemoryValue(
            VT_MEMORY, new(&frame) PropertyAccessor(frame.locals[0].raw.fval, frame.locals[1].raw.fval)
        );
    }

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
        newInit< PrototypeCreator<Object,String> >(&frame, &frame.locals[0], objectPrototype),
        stringConstructor, stringFunction, "String", 1, &stringPrototype, &string
    );
    // String.prototype.charCodeAt()
    defineMethod(&frame, stringPrototype, "charCodeAt", 1, stringCharCodeAt);
    defineMethod(&frame, stringPrototype, "charAt", 1, stringCharAt);
    defineMethod(&frame, stringPrototype, "slice", 2, stringSlice);
    defineMethod(&frame, stringPrototype, "substring", 2, stringSubstring);
    defineMethod(&frame, stringPrototype, "substr", 2, stringSubstr);
    defineMethod(&frame, string,          "fromCharCode", 1, stringFromCharCode);

    // Number
    //
    systemConstructor(
        &frame, 6,
        newInit< PrototypeCreator<Object,Number> >(&frame, &frame.locals[0], objectPrototype),
        numberConstructor, numberFunction, "Number", 1, &numberPrototype, &number
    );
    // Boolean
    //
    systemConstructor(
        &frame, 8,
        newInit< PrototypeCreator<Object,Boolean> >(&frame, &frame.locals[0], objectPrototype),
        booleanConstructor, booleanFunction, "Boolean", 1, &booleanPrototype, &boolean
    );
    // Array
    //
    systemConstructor(
        &frame, 10,
        newInit< PrototypeCreator<Object,Array> >(&frame, &frame.locals[0], objectPrototype),
        arrayConstructor, arrayFunction, "Array", 1, &arrayPrototype, &array
    );
    defineMethod(&frame, arrayPrototype, "sort", 1, arraySort);
    // Error
    //
    systemConstructor(
        &frame, 12,
        newInit< PrototypeCreator<Error,Error> >(&frame, &frame.locals[0], objectPrototype),
        errorConstructor, errorFunction, "Error", 1, &errorPrototype, &error
    );
    // Error.prototype.name
    errorPrototype->defineOwnProperty(
        &frame, permStrName, PROP_NORMAL, makeStringValue(internString(&frame, true, "Error"))
    );
    // Error.prototype.message
    errorPrototype->defineOwnProperty( &frame, permStrMessage, PROP_NORMAL, makeStringValue(permStrEmpty));

    // TypeError
    //
    systemConstructor(
        &frame, 14,
        newInit< PrototypeCreator<Object,Error> >(&frame, &frame.locals[0], errorPrototype),
        typeErrorConstructor, typeErrorFunction, "TypeError", 1, &typeErrorPrototype, &typeError
    );
    // TypeError.prototype.name
    typeErrorPrototype->defineOwnProperty(
        &frame, permStrName, PROP_NORMAL, makeStringValue(internString(&frame, true, "TypeError"))
    );

    // Typed arrays
    //
    systemConstructor(
        &frame, 18,
        newInit< PrototypeCreator<Object,ArrayBuffer> >(&frame, &frame.locals[0], objectPrototype),
        ArrayBuffer::aConstructor, ArrayBuffer::aFunction, "ArrayBuffer", 1, &arrayBufferPrototype, &arrayBuffer
    );
    systemConstructor(
        &frame, 20,
        newInit< PrototypeCreator<Object,DataView> >(&frame, &frame.locals[0], objectPrototype),
        DataView::aConstructor, DataView::aFunction, "DataView", 3, &dataViewPrototype, &dataView
    );
#define _JS_TA_DEF(index, name, Name) \
    systemConstructor( \
        &frame, index, \
        newInit< PrototypeCreator<Object,js::Name##Array> >(&frame, &frame.locals[0], objectPrototype), \
        js::Name##Array::aConstructor, js::Name##Array::aFunction, #name "Array", 3, &name##ArrayPrototype, &name##Array \
    )

    _JS_TA_DEF(22, int8, Int8);
    _JS_TA_DEF(24, uint8, Uint8);
    _JS_TA_DEF(26, uint8Clamped, Uint8Clamped);
    _JS_TA_DEF(28, int16, Int16);
    _JS_TA_DEF(30, uint16, Uint16);
    _JS_TA_DEF(32, int32, Int32);
    _JS_TA_DEF(34, uint32, Uint32);
    _JS_TA_DEF(36, float32, Float32);
    _JS_TA_DEF(38, float64, Float64);
#undef _JS_TA_DEF

    // Next free is env[40]
}

void Runtime::systemConstructor (
    StackFrame * caller, unsigned envIndex, Object * prototype, CodePtr consCode, CodePtr code,
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
    constructor->init(caller, env, code, consCode, internString(caller, true, name), length);
    constructor->definePrototype(caller, prototype);

    prototype->defineOwnProperty(
        caller, permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, makeObjectValue(constructor)
    );

    *outConstructor = constructor;
}

void Runtime::defineMethod (StackFrame * caller, Object * prototype, const char * sname, unsigned length, CodePtr code)
{
    StackFrameN<0,2,0> frame(caller, NULL, __FILE__ ":Runtime::defineMethod", __LINE__);
    const StringPrim * name;
    frame.locals[0] = makeStringValue(name = internString(&frame, true, sname));
    frame.locals[1] = newFunction(&frame, env, name, length, code);
    prototype->defineOwnProperty(&frame, name, PROP_WRITEABLE|PROP_CONFIGURABLE, frame.locals[1]);
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
#if 0 // The GC has special handling of interned strings, so we must not mark them
    for ( auto it : this->permStrings )
        if (!markMemory(marker, markBit, it.second))
            return false;
#endif
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

const StringPrim * Runtime::findInterned (const StringPrim * str)
{
    if (JS_UNLIKELY(str->isInterned()))
        return str;

    auto it = permStrings.find(PasStr(str->byteLength, str->_str));
    return it != permStrings.end() ? it->second : NULL;
}

const StringPrim * Runtime::internString (StackFrame * caller, bool permanent, const char * str, unsigned len)
{
    const StringPrim * res;
    auto it = permStrings.find(PasStr(len, (const unsigned char *)str));
    if (it == permStrings.end()) {
        res = StringPrim::makeFromValid(caller, str, len);
        res->stringFlags |= StringPrim::F_INTERNED | (permanent ? StringPrim::F_PERMANENT : 0);
        permStrings[PasStr(len, res->_str)] = res;
    } else {
        res = it->second;
        if (JS_UNLIKELY(permanent)) // avoid writing to the existing entry unless we have to
            res->stringFlags |= StringPrim::F_PERMANENT;
    }
    return res;
}
const StringPrim * Runtime::internString (StackFrame * caller, bool permanent, const char * str)
{
    return internString(caller, permanent, str, (unsigned)strlen(str));
}

const StringPrim * Runtime::internString (const StringPrim * str)
{
    if (JS_UNLIKELY(str->isInterned()))
        return str;

    auto res = permStrings.insert(std::make_pair(PasStr(str->byteLength, str->_str), str));
    if (res.second) {
        str->stringFlags |= StringPrim::F_INTERNED;
        return str;
    } else {
        return res.first->second;
    }
}

void Runtime::uninternString (StringPrim * str)
{
    assert((str->stringFlags & (StringPrim::F_INTERNED | StringPrim::F_PERMANENT)) == StringPrim::F_INTERNED);
    size_t t = this->permStrings.erase(PasStr(str->byteLength, str->_str));
    assert(t == 1);
    str->stringFlags &= ~StringPrim::F_INTERNED;
}

void Runtime::initStrings (
    StackFrame * caller, const StringPrim ** prims, const char * strconst, const unsigned * offsets, unsigned count
)
{
    for ( unsigned i = 0; i < count; ++i )
        prims[i] = internString(caller, true, strconst + offsets[i << 1], offsets[(i << 1) + 1]);
}

/**
 * @throws if parent is not an object or null
 */
Object * objectCreate (StackFrame * caller, TaggedValue parent)
{
    if (isValueTagObject(parent.tag))
        return parent.raw.oval->createDescendant(caller);
    else if (parent.tag == VT_NULL)
        return newInit<Object>(caller, NULL);
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

    Object * prototype = newInit<Object>(&frame, &frame.locals[1], JS_GET_RUNTIME(&frame)->objectPrototype);
    prototype->defineOwnProperty(
        &frame, JS_GET_RUNTIME(caller)->permStrConstructor, PROP_WRITEABLE | PROP_CONFIGURABLE, frame.locals[0]
    );

    func->definePrototype(&frame, prototype, PROP_WRITEABLE);

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
        frame.locals[1] = makeStringValue(StringPrim::makeFromValid(&frame, buf));
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

InternalClass getInternalClass (TaggedValue a)
{
    switch (a.tag) {
        case VT_UNDEFINED: return ICLS_UNDEFINED;
        case VT_NULL:      return ICLS_NULL;
        case VT_BOOLEAN:   return ICLS_BOOLEAN;
        case VT_NUMBER:    return ICLS_NUMBER;
        case VT_STRINGPRIM:return ICLS_STRING_PRIM;
        case VT_OBJECT:    return a.raw.oval->getInternalClass();
        default:
            assert(false);
            return ICLS_UNDEFINED;
    }
}

void put (StackFrame * caller, TaggedValue obj, const StringPrim * propName, TaggedValue val)
{
    switch (obj.tag) {
        case VT_UNDEFINED: throwTypeError(caller, "cannot assign property '%s' of undefined", propName->getStr()); break;
        case VT_NULL:      throwTypeError(caller, "cannot assign property '%s' of null", propName->getStr()); break;

        case VT_OBJECT:    obj.raw.oval->put(caller, propName, val); break;

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

        case VT_OBJECT: obj.raw.oval->putComputed(caller, propName, val); break;

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

        case VT_OBJECT:   return obj.raw.oval->get(caller, propName); break;

        case VT_NUMBER:   return JS_GET_RUNTIME(caller)->numberPrototype->get(caller, propName);
        case VT_BOOLEAN:  return JS_GET_RUNTIME(caller)->booleanPrototype->get(caller, propName);
        case VT_STRINGPRIM: {
            Runtime * r = JS_GET_RUNTIME(caller);
            if (propName == r->permStrLength)
                return makeNumberValue(obj.raw.sval->charLength);
            else
                return JS_GET_RUNTIME(caller)->stringPrototype->get(caller, propName);
        }

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

        case VT_OBJECT:  return obj.raw.oval->getComputed(caller, propName); break;

        case VT_NUMBER:  return JS_GET_RUNTIME(caller)->numberPrototype->getComputed(caller, propName);
        case VT_BOOLEAN: return JS_GET_RUNTIME(caller)->booleanPrototype->getComputed(caller, propName);
        case VT_STRINGPRIM: {
            uint32_t index;
            if (JS_LIKELY(isValidArrayIndexNumber(propName, &index)))
                return obj.raw.sval->charAt(caller, index);

            StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":getComputed", __LINE__);
            frame.locals[0] = toString(&frame, propName);
            if (isIndexString(frame.locals[0].raw.sval->getStr(), &index))
                return obj.raw.sval->charAt(&frame, index);

            Runtime * r = JS_GET_RUNTIME(caller);
            if (r->findInterned(frame.locals[0].raw.sval) == r->permStrLength)
                return makeNumberValue(obj.raw.sval->charLength);
            else
                return r->stringPrototype->getComputed(&frame, propName);
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
            return v.raw.sval->byteLength != 0;
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

        case VT_BOOLEAN:    return newInit2<Boolean>(caller, JS_GET_RUNTIME(caller)->booleanPrototype, v);
        case VT_NUMBER:     return newInit2<Number>(caller, JS_GET_RUNTIME(caller)->numberPrototype, v);
        case VT_STRINGPRIM: return newInit2<String>(caller, JS_GET_RUNTIME(caller)->stringPrototype, v);
        default:
            assert(isValueTagObject(v.tag));
            return v.raw.oval;
    }
}

TaggedValue toString (StackFrame * caller, double n)
{
    return makeStringValue(numberToString(caller, n, 10));
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
        case VT_OBJECT: {
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
    StringPrim * res = StringPrim::makeEmpty(caller, a->byteLength + b->byteLength);
    memcpy( res->_str, a->_str, a->byteLength);
    memcpy( res->_str+a->byteLength, b->_str, b->byteLength);
    res->init();
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
