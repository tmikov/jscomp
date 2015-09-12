// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/objects.h"

namespace js {

Handles::Handles () :
    m_firstFreeSlot(0),
    m_level(0),
    m_capacity(128)
{
    m_slots = (HandleSlot *)::malloc(sizeof(m_slots[0]) * m_capacity);
    if (!m_slots)
        throw new std::bad_alloc();
}

unsigned Handles::newHandle (StackFrame * caller, Memory * mem)
{
    unsigned res;

    if (m_firstFreeSlot != 0) {
        res = (unsigned)(m_firstFreeSlot >> 1);
        m_firstFreeSlot = m_slots[res].nextFree;
    } else if (m_level < m_capacity) {
        res = m_level++;
    } else {
        // Reallocate
        void * tmp;
        unsigned newCap = m_capacity * 2;
        if (newCap <= m_capacity)
            newCap = m_capacity + 1;

        tmp = ::realloc(m_slots, newCap);
        if (!tmp)
            js::throwOutOfMemory(caller);

        m_capacity = newCap;
        m_slots = (HandleSlot *)tmp;

        res = m_level++;
    }

    m_slots[res].mem = mem;
    return res + 1;
}

Memory * Handles::handle (unsigned hnd)
{
    assert(hnd > 0 && hnd <= m_level);
    assert((m_slots[hnd-1].nextFree & 1) == 0);
    return m_slots[hnd-1].mem;
}

void Handles::destroyHandle (unsigned hnd)
{
    if (JS_UNLIKELY(hnd == 0))
        return;

    assert(hnd <= m_level);
    assert((m_slots[hnd-1].nextFree & 1) == 0);

    --hnd;
    m_slots[hnd].nextFree = m_firstFreeSlot;
    m_firstFreeSlot = ((uintptr_t)hnd << 1) | 1;
}

}; // namespacejs
