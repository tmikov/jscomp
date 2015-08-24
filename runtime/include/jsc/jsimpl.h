// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_JSIMPL_H
#define JSCOMP_JSIMPL_H

#ifndef JSCOMP_JSRUNTIME_H
#include "jsc/jsruntime.h"
#endif

namespace js {

// Need our own definition to avoid warnings when using it on C++ objects
#define OFFSETOF(type, field)  ((char*)&(((type*)0)->field) - ((char*)0) )

/**
 * Return true if "value" is representable as uint32_t, and store the uint32_t value in "res"
 */
#define IS_FAST_UINT32(value,res)  ((value).tag == VT_NUMBER && ((res) = (uint32_t)(value).raw.nval) == (value).raw.nval)
#define IS_FAST_INT32(value,res)   ((value).tag == VT_NUMBER && ((res) = (int32_t)(value).raw.nval) == (value).raw.nval)

class StringBuilder
{
    unsigned char * m_buf;
    size_t m_cap;
    size_t m_len;

    void growTo (StackFrame * caller, size_t minSize);
public:
    StringBuilder (StackFrame * caller, size_t initialCapacity)
    {
        if (!(m_buf = (unsigned char *)malloc(initialCapacity)))
            throwOutOfMemory(caller);
        m_cap = initialCapacity;
        m_len = 0;
    }

    ~StringBuilder ()
    {
        free(m_buf);
    }

    size_t getLen () const
    {
        return m_len;
    }

    unsigned char * getBuf ()
    {
        return m_buf;
    }

    const StringPrim * toStringPrim (StackFrame * caller) const;

    void reserveSpaceFor (StackFrame * caller, size_t extraLen)
    {
        if (m_cap - m_len < extraLen)
            growTo(caller, m_len + extraLen);
    }

    void addUnsafe (const unsigned char * src, size_t len)
    {
        memcpy(m_buf + m_len, src, len);
        m_len += len;
    }

    void addUnsafe (unsigned char ch)
    {
        m_buf[m_len++] = ch;
    }

    void add (StackFrame * caller, const unsigned char * src, size_t len)
    {
        if (JS_UNLIKELY(m_cap - m_len < len))
            growTo(caller, m_len + len);
        addUnsafe(src, len);
    }

    void add (StackFrame * caller, unsigned char ch)
    {
        if (JS_UNLIKELY(m_cap == m_len))
            growTo(caller, m_len + 1);
        addUnsafe(ch);
    }
};

}; // namespace js

#endif //JSCOMP_JSIMPL_H
