// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_TYPEDARRAYS_H
#define JSCOMP_TYPEDARRAYS_H

#ifndef JSCOMP_OBJECTS_H
#include "jsc/objects.h"
#endif

namespace js {

class ArrayBuffer : public Object
{
    typedef Object super;
public:
    size_t byteLength;
    void * data;

    ArrayBuffer (Object * parent) :
        Object(parent),
        byteLength(0),
        data(NULL)
    {}

    virtual ~ArrayBuffer ();
    virtual InternalClass getInternalClass () const;

    void allocateBuffer (StackFrame * caller, double flen);

    static TaggedValue aConstructor (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
    static TaggedValue aFunction (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
};

class DataView : public Object
{
    typedef Object super;
public:
    ArrayBuffer * buffer;
    size_t byteOffset;
    size_t byteLength;
    void * data;

    DataView (Object * parent) :
        Object(parent),
        buffer(NULL),
        byteOffset(0),
        byteLength(0),
        data(NULL)
    {}

    virtual InternalClass getInternalClass () const;

    virtual bool mark (IMark * marker, unsigned markBit) const;

    static TaggedValue aFunction (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
    static TaggedValue aConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);

private:
    void setBuffer (ArrayBuffer * buffer, size_t byteOffset, size_t byteLength)
    {
        this->buffer = buffer;
        this->byteOffset = byteOffset;
        this->byteLength = byteLength;
        this->data = (char*)buffer->data + byteOffset;
    }
};

class ArrayBufferView : public IndexedObject
{
    typedef IndexedObject super;
public:
    ArrayBuffer * buffer;
    size_t byteOffset;
    size_t byteLength;
    void * data;
    size_t length;
    unsigned bytesPerElement;

    ArrayBufferView (Object * parent) :
        IndexedObject(parent),
        buffer(NULL),
        byteOffset(0),
        byteLength(0),
        data(NULL),
        length(0),
        bytesPerElement(0)
    {}

    virtual bool mark (IMark * marker, unsigned markBit) const;

    static TaggedValue aFunction (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
    TaggedValue construct (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);

    void copyFrom (StackFrame * caller, TaggedValue fromP, TaggedValue offsetP);

    virtual uint32_t getIndexedLength () const;
    virtual bool hasIndex (uint32_t index) const;
    virtual bool deleteAtIndex (uint32_t);
private:
    void setBuffer (ArrayBuffer * buffer, size_t byteOffset, size_t byteLength, size_t length)
    {
        this->buffer = buffer;
        this->byteOffset = byteOffset;
        this->byteLength = byteLength;
        this->data = (char*)buffer->data + byteOffset;
        this->length = length;
    }

    void allocateBuffer (StackFrame * caller, double flen);
};

template <class T, InternalClass ICLS>
class TypedArray : public ArrayBufferView
{
    typedef ArrayBufferView super;
    typedef TypedArray<T,ICLS> ThisClass;
public:
    enum { BYTES_PER_ELEMENT = (unsigned)sizeof(T) };

    TypedArray (Object * parent) :
        ArrayBufferView(parent)
    { }

    virtual InternalClass getInternalClass () const
    {
        return ICLS;
    }

    virtual TaggedValue getAtIndex (StackFrame * caller, uint32_t index) const
    {
        return JS_LIKELY(index < length) ? makeNumberValue(((T *)this->data)[index]) : JS_UNDEFINED_VALUE;
    }

    virtual bool setAtIndex (StackFrame * caller, uint32_t index, TaggedValue value)
    {
        if (JS_LIKELY(index < length)) {
            if (JS_LIKELY(value.tag == VT_NUMBER)) {
                ((T *)this->data)[index] = isfinite(value.raw.nval) ? (T)value.raw.nval : 0;
            }
            else {
                double val = toNumber(caller, value);
                ((T *)this->data)[index] = isfinite(val) ? (T)value.raw.nval : 0;
            }
        }
        return true;
    }

    static TaggedValue aConstructor (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
    {
        assert(isValueTagObject(argv[0].tag) && argv[0].raw.oval->getInternalClass() == ICLS);
        ArrayBufferView * abv = (ArrayBufferView *)argv[0].raw.oval;
        abv->bytesPerElement = BYTES_PER_ELEMENT;
        return abv->construct(caller, env, argc, argv);
    }
};

typedef TypedArray<int8_t,ICLS_Int8Array>     Int8Array;
typedef TypedArray<uint8_t,ICLS_Uint8Array>   Uint8Array;
typedef TypedArray<int16_t,ICLS_Int16Array>   Int16Array;
typedef TypedArray<uint16_t,ICLS_Uint16Array> Uint16Array;
typedef TypedArray<int32_t,ICLS_Int32Array>   Int32Array;
typedef TypedArray<uint32_t,ICLS_Uint32Array> Uint32Array;
typedef TypedArray<float,ICLS_Float32Array>   Float32Array;
typedef TypedArray<double,ICLS_Float64Array>  Float64Array;

class Uint8ClampedArray : public TypedArray<uint8_t, ICLS_Uint8ClampedArray>
{
    typedef TypedArray<uint8_t, ICLS_Uint8ClampedArray> super;
public:
    Uint8ClampedArray (Object * parent) :
        super(parent)
    {}

    virtual bool setAtIndex (StackFrame * caller, uint32_t index, TaggedValue value)
    {
        if (JS_LIKELY(index < length)) {
            double val = JS_LIKELY(value.tag == VT_NUMBER) ? value.raw.nval : toNumber(caller, value);
            uint8_t n;
            if (JS_UNLIKELY(isnan(val) || val < 0))
                n = 0;
            else if (JS_UNLIKELY(val > 255))
                n = 255;
            else
                n = (uint8_t)val;

            ((uint8_t *)this->data)[index] = n;
        }
        return true;
    }
};

float getFloat32 (const uint8_t * s, bool littleEndian);
double getFloat64 (const uint8_t * s, bool littleEndian);
void setFloat32 (uint8_t * d, float v, bool littleEndian);
void setFloat64 (uint8_t * d, double v, bool littleEndian);

}; // namespace js

#endif //JSCOMP_TYPEDARRAYS_H
