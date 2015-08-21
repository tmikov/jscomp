// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/typedarrays.h"
#include "jsc/jsimpl.h"
#include "jsc/config.h"

#include ENDIAN_H

namespace js {

ArrayBuffer::~ArrayBuffer ()
{
    if (data)
        free(data);
}

InternalClass ArrayBuffer::getInternalClass () const
{
    return ICLS_ArrayBuffer;
}

void ArrayBuffer::allocateBuffer (StackFrame * caller, double flen)
{
    if (flen < 0 || flen > SIZE_MAX)
        throwTypeError(caller, "Invalid length");

    size_t byteLength = (size_t)flen;
    if (!(this->data = malloc(byteLength)))
        throwOutOfMemory(caller);
    this->byteLength = byteLength;
}

TaggedValue ArrayBuffer::aConstructor (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    TaggedValue thisp = argv[0];
    TaggedValue length = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;

    assert(isValueTagObject(thisp.tag) && thisp.raw.oval->getInternalClass() == ICLS_ArrayBuffer);
    ArrayBuffer * ab = (ArrayBuffer *)thisp.raw.oval;
    ab->allocateBuffer(caller, toInteger(caller, length));
    ::memset(ab->data, 0, ab->byteLength);

    return JS_UNDEFINED_VALUE;
}

TaggedValue ArrayBuffer::aFunction (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    throwTypeError(caller, "ArrayBuffer requires 'new'");
}

InternalClass DataView::getInternalClass () const
{
    return ICLS_DataView;
}

bool DataView::mark (IMark * marker, unsigned markBit) const
{
    return markMemory(marker, markBit, this->buffer);
}

TaggedValue DataView::aFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *)
{
    throwTypeError(caller, "DataView requires 'new'");
}

TaggedValue DataView::aConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    TaggedValue thisP = argv[0];
    TaggedValue bufferP = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    TaggedValue byteOffsetP = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;
    TaggedValue byteLengthP = argc > 3 ? argv[3] : JS_UNDEFINED_VALUE;

    assert(isValueTagObject(thisP.tag) && thisP.raw.oval->getInternalClass() == ICLS_DataView);
    DataView * dv = (DataView *)thisP.raw.oval;

    if (!isValueTagObject(bufferP.tag) || bufferP.raw.oval->getInternalClass() != ICLS_ArrayBuffer)
        throwTypeError(caller, "'buffer' is not an ArrayObject");
    ArrayBuffer * ab = (ArrayBuffer *)bufferP.raw.oval;

    double byteOffsetF = toInteger(caller, byteOffsetP);
    if (byteOffsetF < 0 || byteOffsetF > ab->byteLength)
        throwTypeError(caller, "invalid byteOffset");
    size_t byteOffset = (size_t)byteOffsetF;

    size_t byteLength;
    if (byteLengthP.tag == VT_UNDEFINED) {
        byteLength = ab->byteLength - byteOffset;
    } else {
        double byteLengthF = toInteger(caller, byteLengthP);
        if (byteLengthF < 0 || byteOffset + byteLengthF > ab->byteLength)
            throwTypeError(caller, "invalid byteLength");
        byteLength = (size_t)byteLengthF;
    }

    dv->setBuffer(ab, byteOffset, byteLength);
    return JS_UNDEFINED_VALUE;
}

bool ArrayBufferView::mark (IMark * marker, unsigned markBit) const
{
    return markMemory(marker, markBit, this->buffer);
}

TaggedValue ArrayBufferView::aFunction (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv)
{
    throwTypeError(caller, "Typed array requires 'new'");
}

TaggedValue ArrayBufferView::construct (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv)
{
    TaggedValue arg1 = argc > 1 ? argv[1] : JS_UNDEFINED_VALUE;
    TaggedValue lengthProp;
    InternalClass icls;

    icls = isValueTagObject(arg1.tag) ? arg1.raw.oval->getInternalClass() : (InternalClass)0;

    if (icls >= ICLS_Int8Array && icls <= ICLS_Float64Array)
    {
        // TypedArray(TypedArray array)
        ArrayBufferView * abv = (ArrayBufferView *)arg1.raw.oval;
        allocateBuffer(caller, abv->length);

        if (this->getInternalClass() == icls ||
            (abv->bytesPerElement == this->bytesPerElement && icls < ICLS_Float32Array))
        {
            memcpy(this->data, abv->data, this->byteLength);
        } else {
            for ( size_t i = 0, len = this->length; i < len; ++i )
                this->setAtIndex(caller, i, abv->getAtIndex(caller, i));
        }
    } else if (icls == ICLS_ArrayBuffer) {
        // TypedArray(ArrayBuffer buffer, optional unsigned long byteOffset, optional unsigned long length)
        ArrayBuffer * ab = (ArrayBuffer *)arg1.raw.oval;

        TaggedValue byteOffsetP = argc > 2 ? argv[2] : JS_UNDEFINED_VALUE;
        TaggedValue lengthP = argc > 3 ? argv[3] : JS_UNDEFINED_VALUE;

        double byteOffsetF = toInteger(caller, byteOffsetP);
        if (byteOffsetF < 0 || byteOffsetF > ab->byteLength)
            throwTypeError(caller, "invalid byteOffset");
        size_t byteOffset = (size_t)byteOffsetF;
        if ((byteOffset % this->bytesPerElement) != 0)
            throwTypeError(caller, "invalid byteOffset");

        size_t length;
        if (lengthP.tag != VT_UNDEFINED) {
            double lengthF = toInteger(caller, lengthP);
            if (byteOffset + lengthF*this->bytesPerElement > ab->byteLength)
                throwTypeError(caller, "invalid length");
            length = (size_t)lengthF;
        } else {
            if (((ab->byteLength - byteOffset) % this->bytesPerElement) != 0)
                throwTypeError(caller, "invalid length");
            length = (ab->byteLength - byteOffset) / this->bytesPerElement;
        }

        setBuffer(ab, byteOffset, length * this->bytesPerElement, length);
    } else if (isValueTagObject(arg1.tag) &&
        (lengthProp = arg1.raw.oval->get(caller, JS_GET_RUNTIME(caller)->permStrLength)).tag != VT_UNDEFINED)
    {
        // TypedArray(array-like)
        allocateBuffer(caller, toInteger(caller, lengthProp));
        for ( size_t i = 0, len = this->length; i < len; ++i )
            this->setAtIndex(caller, i, js::getComputed(caller, arg1, makeNumberValue(i)));
    } else {
        // TypedArray(length)
        allocateBuffer(caller, toInteger(caller, arg1));
        ::memset(this->data, 0, this->byteLength);
    }

    return JS_UNDEFINED_VALUE;
}

void ArrayBufferView::copyFrom (StackFrame * caller, TaggedValue fromP, TaggedValue offsetP)
{
    if (!isValueTagObject(fromP.tag))
        throwTypeError(caller, "invalid source array");

    InternalClass const icls = fromP.raw.oval->getInternalClass();
    size_t offset;

    if (offsetP.tag == VT_UNDEFINED)
        offset = 0;
    else if (JS_LIKELY(offsetP.tag == VT_NUMBER && (offset = (size_t)offsetP.raw.nval) == offsetP.raw.nval)) {
        // fast path
        if (offset >= this->length)
            throwTypeError(caller, "invalid offset");
    } else {
        double offsetF = toInteger(caller, offsetP);
        if (offsetF < 0 || offsetF >= this->length)
            throwTypeError(caller, "invalid offset");
        offset = (size_t)offsetF;
    }

    if (icls >= ICLS_Int8Array && icls <= ICLS_Float64Array)
    {
        ArrayBufferView * abv = (ArrayBufferView *)fromP.raw.oval;

        if (this->length - offset < abv->length)
            throwTypeError(caller, "source is too large");

        if (this->getInternalClass() == icls ||
            (abv->bytesPerElement == this->bytesPerElement && icls < ICLS_Float32Array))
        {
            memmove((char *)this->data + offset*this->bytesPerElement, abv->data, abv->byteLength);
        } else {
            for ( size_t i = 0, len = abv->length; i < len; ++i, ++offset )
                this->setAtIndex(caller, offset, abv->getAtIndex(caller, i));
        }
    } else {
        double lengthF = toInteger(caller, fromP.raw.oval->get(caller, JS_GET_RUNTIME(caller)->permStrLength));
        if (this->length - offset < lengthF)
            throwTypeError(caller, "source is too large");
        size_t length = (size_t)lengthF;

        for ( size_t i = 0; i < length; ++i, ++offset )
            this->setAtIndex(caller, offset, js::getComputed(caller, fromP, makeNumberValue(i)));
    }
}

void ArrayBufferView::allocateBuffer (StackFrame * caller, double flen)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ ":ArrayBufferView::allocateBuffer()", __LINE__);
    if (flen < 0 || flen > SIZE_MAX)
        throwTypeError(&frame, "invalid length");

    ArrayBuffer * ab;
    frame.locals[0] = makeObjectValue(
        ab = (ArrayBuffer *)JS_GET_RUNTIME(&frame)->arrayBufferPrototype->createDescendant(&frame)
    );
    ab->allocateBuffer(&frame, flen * this->bytesPerElement);
    this->setBuffer(ab, 0, ab->byteLength, (size_t)flen);
}

uint32_t ArrayBufferView::getIndexedLength () const
{
    return this->length;
}

bool ArrayBufferView::hasIndex (uint32_t index) const
{
    return index < this->length;
}

bool ArrayBufferView::deleteAtIndex (uint32_t)
{
    return true;
}

#ifndef BYTE_ORDER
#error "BYTE_ORDER needs to be defined"
#endif

float getFloat32 (const uint8_t * s, bool littleEndian)
{
    union {
        float f;
        uint8_t b[4];
    } u;
#if BYTE_ORDER == LITTLE_ENDIAN
    if (littleEndian) {
#else
    if (!littleEndian) {
#endif
        u.b[0] = s[0];
        u.b[1] = s[1];
        u.b[2] = s[2];
        u.b[3] = s[3];
    } else {
        u.b[0] = s[3];
        u.b[1] = s[2];
        u.b[2] = s[1];
        u.b[3] = s[0];
    }
    return u.f;
};

double getFloat64 (const uint8_t * s, bool littleEndian)
{
    union {
        double f;
        uint8_t b[8];
    } u;
#if BYTE_ORDER == LITTLE_ENDIAN
    if (littleEndian) {
#else
    if (!littleEndian) {
#endif
        u.b[0] = s[0];
        u.b[1] = s[1];
        u.b[2] = s[2];
        u.b[3] = s[3];
        u.b[4] = s[4];
        u.b[5] = s[5];
        u.b[6] = s[6];
        u.b[7] = s[7];
    } else {
        u.b[0] = s[7];
        u.b[1] = s[6];
        u.b[2] = s[5];
        u.b[3] = s[4];
        u.b[4] = s[3];
        u.b[5] = s[2];
        u.b[6] = s[1];
        u.b[7] = s[0];
    }
    return u.f;
}

void setFloat32 (uint8_t * d, float v, bool littleEndian)
{
    union {
        float f;
        uint8_t b[4];
    } u;
    u.f = v;
#if BYTE_ORDER == LITTLE_ENDIAN
    if (littleEndian) {
#else
    if (!littleEndian) {
#endif
        d[0] = u.b[0];
        d[1] = u.b[1];
        d[2] = u.b[2];
        d[3] = u.b[3];
    } else {
        d[0] = u.b[3];
        d[1] = u.b[2];
        d[2] = u.b[1];
        d[3] = u.b[0];
    }
}

void setFloat64 (uint8_t * d, double v, bool littleEndian)
{
    union {
        double f;
        uint8_t b[8];
    } u;
    u.f = v;
#if BYTE_ORDER == LITTLE_ENDIAN
    if (littleEndian) {
#else
    if (!littleEndian) {
#endif
        d[0] = u.b[0];
        d[1] = u.b[1];
        d[2] = u.b[2];
        d[3] = u.b[3];
        d[4] = u.b[4];
        d[5] = u.b[5];
        d[6] = u.b[6];
        d[7] = u.b[7];
    } else {
        d[0] = u.b[7];
        d[1] = u.b[6];
        d[2] = u.b[5];
        d[3] = u.b[4];
        d[4] = u.b[3];
        d[5] = u.b[2];
        d[6] = u.b[1];
        d[7] = u.b[0];
    }
}

}; // namespace js

