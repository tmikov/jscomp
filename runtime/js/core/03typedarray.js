// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

// ArrayBuffer
//
function assertArrayBuffer (v)
{
    if (getInternalClass(v) !== ICLS_ArrayBuffer)
        throw TypeError("not an ArrayBuffer");
}

getter(ArrayBuffer.prototype, "byteLength", function arrayBuffer_byteLength ()
{
    assertArrayBuffer(this);
    return __asm__({},["res"],[["this",this]],[],
        "%[res] = js::makeNumberValue(((js::ArrayBuffer *)%[this].raw.oval)->byteLength);"
    );
});

hidden(ArrayBuffer.prototype, "slice", function arrayBuffer_slice (begin, end)
{
    assertArrayBuffer(this);

    var thisLen = this.byteLength;

    begin = +begin;
    if (begin < 0) {
        if ( (begin += thisLen) < 0)
            begin = 0;
    } else if (begin > thisLen) {
        begin =  thisLen;
    }

    if (end === undefined) {
        end = thisLen;
    } else {
        end = +end;
        if (end < 0) {
            if ( (end += thisLen) < 0)
                end = 0;
        } else if (end > thisLen) {
            end = thisLen;
        }
    }

    if (end < begin)
        end = begin;

    return __asm__({},["res"],[["this", this],["begin",begin],["end",end]],[],
        "size_t b = (size_t)%[begin].raw.nval;\n" +
        "size_t e = (size_t)%[end].raw.nval;\n" +
        "js::ArrayBuffer * ab;\n" +
        "%[res] = js::makeObjectValue(" +
        "ab = (js::ArrayBuffer *)JS_GET_RUNTIME(%[%frame])->arrayBufferPrototype->createDescendant(%[%frame])" +
        ");\n" +
        "ab->allocateBuffer(%[%frame], e - b);\n" +
        "::memcpy(ab->data, (const char *)((js::ArrayBuffer *)%[this].raw.oval)->data + b, e - b);"
    );
});

function arrayBuffer_isView (val)
{
    var icls = getInternalClass(val);
    return icls >= ICLS_DataView && icls <= ICLS_Float64Array;
}

hidden(ArrayBuffer, "isView", arrayBuffer_isView);

function assertDataView(x)
{
    if (getInternalClass(x) !== ICLS_DataView)
        throw TypeError("not a DataView");
}

getter(DataView.prototype, "buffer", function dataView_buffer ()
{
    assertDataView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::DataView * abv = (js::DataView *)%[this].raw.oval;\n" +
        "%[res] = js::makeObjectValue(abv->buffer);"
    );
});
getter(DataView.prototype, "byteOffset", function dataView_byteOffset ()
{
    assertDataView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::DataView * abv = (js::DataView *)%[this].raw.oval;\n" +
        "%[res] = js::makeNumberValue(abv->byteOffset);"
    );
});
getter(DataView.prototype, "byteLength", function dataView_byteLength ()
{
    assertDataView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::DataView * abv = (js::DataView *)%[this].raw.oval;\n" +
        "%[res] = js::makeNumberValue(abv->byteLength);"
    );
});

hidden(DataView.prototype, "getInt8", function dataView_getInt8(byteOffset)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 1)
        throw RangeError("invalid byteOffset");
    return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
        "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "%[res] = js::makeNumberValue(d[0]);"
    );
});
hidden(DataView.prototype, "getUint8", function dataView_getInt8(byteOffset)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 1)
        throw RangeError("invalid byteOffset");
    return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
        "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "%[res] = js::makeNumberValue(d[0]);"
    );
});
hidden(DataView.prototype, "getInt16", function dataView_getInt16(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 2)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int16_t tmp = (int16_t)d[0] + ((int16_t)d[1] << 8);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    } else {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int16_t tmp = (int16_t)d[1] + ((int16_t)d[0] << 8);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    }
});
hidden(DataView.prototype, "getUint16", function dataView_getUint16(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 2)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "uint16_t tmp = (uint16_t)d[0] + ((uint16_t)d[1] << 8);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    } else {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "uint16_t tmp = (uint16_t)d[1] + ((uint16_t)d[0] << 8);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    }
});
hidden(DataView.prototype, "getInt32", function dataView_getInt32(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 4)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int32_t tmp = (int32_t)d[0] + ((int32_t)d[1] << 8) + ((int32_t)d[2] << 16) + ((int32_t)d[3] << 24);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    } else {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int32_t tmp = (int32_t)d[3] + ((int32_t)d[2] << 8) + ((int32_t)d[1] << 16) + ((int32_t)d[0] << 24);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    }
});
hidden(DataView.prototype, "getUint32", function dataView_getUint32(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 4)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "uint32_t tmp = (uint32_t)d[0] + ((uint32_t)d[1] << 8) + ((uint32_t)d[2] << 16) + ((uint32_t)d[3] << 24);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    } else {
        return __asm__({},["res"],[["this",this],["byteOffset",byteOffset]],[],
            "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "uint32_t tmp = (uint32_t)d[3] + ((uint32_t)d[2] << 8) + ((uint32_t)d[1] << 16) + ((uint32_t)d[0] << 24);\n" +
            "%[res] = js::makeNumberValue(tmp);"
        );
    }
});

hidden(DataView.prototype, "getFloat32", function dataView_getFloat32(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 4)
        throw RangeError("invalid byteOffset");

    return __asm__({},["res"],[["this",this],["byteOffset",byteOffset],["littleEndian",!!littleEndian]],[],
        "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "%[res] = js::makeNumberValue(js::getFloat32(d, %[littleEndian].raw.bval));"
    );
});
hidden(DataView.prototype, "getFloat64", function dataView_getFloat32(byteOffset, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 8)
        throw RangeError("invalid byteOffset");

    return __asm__({},["res"],[["this",this],["byteOffset",byteOffset],["littleEndian",!!littleEndian]],[],
        "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "%[res] = js::makeNumberValue(js::getFloat64(d, %[littleEndian].raw.bval));"
    );
});

function dataView_setInt8(byteOffset, value)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 1)
        throw RangeError("invalid byteOffset");
    __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",value>>>0]],[],
        "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "*d = (int8_t)%[value].raw.nval;"
    );
}
hidden(DataView.prototype, "setInt8", dataView_setInt8);
hidden(DataView.prototype, "setUint8", dataView_setInt8);

function dataView_setInt16(byteOffset, value, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 2)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",value>>>0]],[],
            "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int16_t tmp = (int16_t)%[value].raw.nval;\n" +
            "d[0] = (int8_t)tmp;\n" +
            "d[1] = (int8_t)(tmp >> 8);"
        );
    } else {
        __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",value>>>0]],[],
            "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int16_t tmp = (int16_t)%[value].raw.nval;\n" +
            "d[1] = (int8_t)tmp;\n" +
            "d[0] = (int8_t)(tmp >> 8);"
        );
    }
}
hidden(DataView.prototype, "setInt16", dataView_setInt16);
hidden(DataView.prototype, "setUint16", dataView_setInt16);

function dataView_setInt32(byteOffset, value, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 4)
        throw RangeError("invalid byteOffset");

    if (littleEndian) {
        __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",value>>>0]],[],
            "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int32_t tmp = (int32_t)%[value].raw.nval;\n" +
            "d[0] = (int8_t)tmp;\n" +
            "d[1] = (int8_t)(tmp >> 8);\n" +
            "d[2] = (int8_t)(tmp >> 16);\n" +
            "d[3] = (int8_t)(tmp >> 24);"
        );
    } else {
        __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",value>>>0]],[],
            "int8_t * d = (int8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
            "int32_t tmp = (int32_t)%[value].raw.nval;\n" +
            "d[3] = (int8_t)tmp;\n" +
            "d[2] = (int8_t)(tmp >> 8);\n" +
            "d[1] = (int8_t)(tmp >> 16);\n" +
            "d[0] = (int8_t)(tmp >> 24);"
        );
    }
}
hidden(DataView.prototype, "setInt32", dataView_setInt32);
hidden(DataView.prototype, "setUint32", dataView_setInt32);

hidden(DataView.prototype, "setFloat32", function dataView_setFloat32(byteOffset, value, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 4)
        throw RangeError("invalid byteOffset");

    __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",+value],["littleEndian", !!littleEndian]],[],
        "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "js::setFloat32(d, %[value].raw.nval, %[littleEndian].raw.bval);"
    );
});
hidden(DataView.prototype, "setFloat64", function dataView_setFloat64(byteOffset, value, littleEndian)
{
    assertDataView(this);
    byteOffset >>>= 0; // convert to uint32
    if (this.byteLength - byteOffset < 8)
        throw RangeError("invalid byteOffset");

    __asm__({},[],[["this",this],["byteOffset",byteOffset],["value",+value],["littleEndian", !!littleEndian]],[],
        "uint8_t * d = (uint8_t *)((js::DataView *)%[this].raw.oval)->data + (size_t)%[byteOffset].raw.nval;\n" +
        "js::setFloat64(d, %[value].raw.nval, %[littleEndian].raw.bval);"
    );
});

function assertArrayBufferView (x)
{
    var icls = getInternalClass(x);
    if (!(icls >= ICLS_Int8Array && icls <= ICLS_Float64Array))
        throw TypeError("not an ArrayBufferView");
}

function arrayBufferView_buffer ()
{
    assertArrayBufferView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::ArrayBufferView * abv = (js::ArrayBufferView *)%[this].raw.oval;\n" +
        "%[res] = js::makeObjectValue(abv->buffer);"
    );
}
function arrayBufferView_byteOffset ()
{
    assertArrayBufferView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::ArrayBufferView * abv = (js::ArrayBufferView *)%[this].raw.oval;\n" +
        "%[res] = js::makeNumberValue(abv->byteOffset);"
    );
}

function arrayBufferView_byteLength ()
{
    assertArrayBufferView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::ArrayBufferView * abv = (js::ArrayBufferView *)%[this].raw.oval;\n" +
        "%[res] = js::makeNumberValue(abv->byteLength);"
    );
}

function arrayBufferView_length ()
{
    assertArrayBufferView(this);
    return __asm__({},["res"],[["this",this]],[],
        "js::ArrayBufferView * abv = (js::ArrayBufferView *)%[this].raw.oval;\n" +
        "%[res] = js::makeNumberValue(abv->length);"
    );
}

function arrayBufferView_set (array, offset)
{
    assertArrayBufferView(this);
    __asm__({},[],[["this",this],["array",array],["offset",offset]],[],
        "js::ArrayBufferView * abv = (js::ArrayBufferView *)%[this].raw.oval;\n" +
        "abv->copyFrom(%[%frame], %[array], %[offset]);"
    );
}

function arrayBufferView_subarray (cons, begin, end)
{
    assertArrayBufferView(this);

    var thisLen = this.length;

    begin = +begin;
    if (begin < 0) {
        if ( (begin += thisLen) < 0)
            begin = 0;
    } else if (begin > thisLen) {
        begin =  thisLen;
    }

    if (end === undefined) {
        end = thisLen;
    } else {
        end = +end;
        if (end < 0) {
            if ( (end += thisLen) < 0)
                end = 0;
        } else if (end > thisLen) {
            end = thisLen;
        }
    }

    if (end < begin)
        end = begin;

    return new cons(this.buffer, begin * this.BYTES_PER_ELEMENT, end - begin);
}

function defineTypedArrayMethods (p, elemSize)
{
    getter(p.prototype, "buffer", arrayBufferView_buffer);
    getter(p.prototype, "byteOffset", arrayBufferView_byteOffset);
    getter(p.prototype, "byteLength", arrayBufferView_byteLength);
    getter(p.prototype, "length", arrayBufferView_length);
    defineProperty(p.prototype, "BYTES_PER_ELEMENT", {configurable: true, value: elemSize});
    hidden(p.prototype, "set", arrayBufferView_set);
    hidden(p.prototype, "subarray", function (begin, end) {
        return arrayBufferView_subarray.call(this, p, begin, end);
    });
}

defineTypedArrayMethods(Int8Array, 1);
defineTypedArrayMethods(Uint8Array, 1);
defineTypedArrayMethods(Uint8ClampedArray, 1);
defineTypedArrayMethods(Int16Array, 2);
defineTypedArrayMethods(Uint16Array, 2);
defineTypedArrayMethods(Int32Array, 4);
defineTypedArrayMethods(Uint32Array, 4);
defineTypedArrayMethods(Float32Array, 4);
defineTypedArrayMethods(Float64Array, 8);
