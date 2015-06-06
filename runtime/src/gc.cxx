// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include <jsc/runtime.h>
#include <assert.h>
#include <typeinfo>
#include <deque>

namespace js
{

static void collect (StackFrame * caller);

Memory * allocate (size_t size, StackFrame * caller)
{
    Runtime * runtime = caller->runtime;

    if (runtime->allocatedSize + size > runtime->gcThreshold)
        collect(caller);

    Memory * block = (Memory *)malloc(size);
    if (block == NULL)
        throw std::bad_alloc();

    block->header = runtime->markBit;
    block->gcSize = size;

    // Attach to the allocated list
    runtime->tail->setNext(block);
    runtime->tail = block;
    runtime->allocatedSize += size;

#ifdef JS_DEBUG
    if (runtime->diagFlags & Runtime::DIAG_HEAP_ALLOC) {
        fprintf(stderr, "js::allocate( %u ) = %p\n", (unsigned)size, block);
        if (runtime->diagFlags & Runtime::DIAG_HEAP_ALLOC_STACK)
            caller->printStackTrace();
    }
#endif

    return block;
}

void _release (Memory * m, Runtime * runtime)
{
    assert(m);
    assert(runtime->allocatedSize >= m->gcSize);
    runtime->allocatedSize -= m->gcSize;
    free(m);
}

void forceGC (StackFrame * caller)
{
    if (caller->runtime->diagFlags & Runtime::DIAG_HEAP_GC)
        fprintf(stderr, "forceGC:");
    collect(caller);
}

struct Marker : public IMark
{
    Runtime * d_runtime;
    unsigned d_markBit;
    std::deque<Memory *> d_markQueue;
#ifdef JS_DEBUG
    unsigned d_maxQueueSize;
#endif

    Marker (Runtime * runtime) :
        d_runtime(runtime)
    {
        d_markBit = runtime->markBit;
        d_maxQueueSize = 0;
    };

    bool _mark (Memory * memory);
};

bool Marker::_mark (Memory * memory)
{
#ifdef JS_DEBUG
    if (d_runtime->diagFlags & Runtime::DIAG_HEAP_GC_VERBOSE)
        fprintf(stderr, "  mark %p %s\n", memory, typeid(*memory).name());
#endif
    // Mark
    assert((memory->header & Memory::MARK_BIT_MASK) != d_markBit);
    memory->header = (memory->header & ~Memory::MARK_BIT_MASK) | d_markBit;

    d_markQueue.push_back(memory);
#ifdef JS_DEBUG
    if (d_markQueue.size() > d_maxQueueSize)
        d_maxQueueSize = (unsigned)d_markQueue.size();
#endif
    return true;
}

static void collect (StackFrame * caller)
{
    Runtime * runtime = caller->runtime;
    unsigned startAllocatedSize = runtime->allocatedSize;
    if (runtime->diagFlags & Runtime::DIAG_HEAP_GC) {
        fprintf(stderr, "GC started. Threshold=%u Allocated=%u\n", runtime->gcThreshold, runtime->allocatedSize);
        if (runtime->diagFlags & Runtime::DIAG_HEAP_GC_VERBOSE)
            caller->printStackTrace();
    }

    // Mark phase
    //
    runtime->markBit ^= 1;
    Marker marker(runtime);

    runtime->mark(&marker, marker.d_markBit);
    caller->mark(&marker, marker.d_markBit);

    while (!marker.d_markQueue.empty()) {
        Memory * m = marker.d_markQueue.front();
        marker.d_markQueue.pop_front();
        m->mark(&marker, marker.d_markBit);
    }

    // Collect all unreachable blocks
    //
    Memory * lastMarked = &runtime->head;
    bool freed = false; // did we free at least one block since we encountered the last marked block
    unsigned const markBit = marker.d_markBit; // cache it for speed
    for (Memory * m = runtime->head.getNext(); m != NULL;) {
        if ((m->header & Memory::MARK_BIT_MASK) != markBit) {
#ifdef JS_DEBUG
            if (runtime->diagFlags & Runtime::DIAG_HEAP_GC_VERBOSE)
                fprintf(stderr, "  free %p %s\n", m, typeid(*m).name());
#endif
            Memory * toFree = m;
            m = m->getNext();
            toFree->~Memory();
            _release(toFree, runtime);
            freed = true;
        } else {
            if (freed) {
                // Chain the last marked block to this one, since we freed blocks in the interim
                lastMarked->setNext(m);
                freed = false;
            }
            lastMarked = m;
            m = m->getNext();
        }
    }

    // If we freed blocks at the end of the list, update the list tail
    if (freed) {
        lastMarked->setNext(NULL);
        runtime->tail = lastMarked;
    }

    if (runtime->diagFlags & Runtime::DIAG_HEAP_GC) {
        runtime->gcThreshold = std::max(runtime->gcThreshold, runtime->allocatedSize * 2);
        fprintf(
            stderr, "Freed %u bytes. Threshold=%u Allocated=%u\n", startAllocatedSize - runtime->allocatedSize,
            runtime->gcThreshold, runtime->allocatedSize
        );
#ifdef JS_DEBUG
        fprintf(stderr, "  Max GC queue size %u elements\n", marker.d_maxQueueSize);
#endif
    }
};

}; // namespace


