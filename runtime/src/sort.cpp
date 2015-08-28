// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/sort.h"

namespace js {

void selectionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
    if (end == begin)
        return;

    for ( uint32_t i = begin, e = end - 1; i != e; ++i ) {
        uint32_t best = i;
        for ( uint32_t j = i + 1; j != end; ++j )
            if (cb->less(caller, j, best))
                best = j;

        if (best != i)
            cb->swap(caller, best, i);
    }
}

void insertionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
    if (begin == end)
        return;

    for ( uint32_t i = begin + 1; i != end; ++i ) {
        for ( unsigned j = i; j != begin && cb->less(caller, j, j-1); --j )
            cb->swap(caller, j, j-1);
    }
}

// Must be at lest 3, for "median of three" to work
#define INSERTION_THRESHOLD 6

static void doQuickSort (StackFrame * caller, IExchangeSortCB * cb, int limit, uint32_t l, uint32_t r)
{
tail_recursion:
    if (limit <= 0) {
        // Bail to heap sort
        heapSort(caller, cb, l, r+1);
        return;
    }

    // Median-of-three
    // Place the middle element at [l+1]
    cb->swap(caller, l+1, l + ((r - l)>>1));
    // Sort, [l], [l+1], [r]
    if (cb->less(caller, r, l+1))
        cb->swap(caller, r, l+1);
    if (cb->less(caller, l+1, l))
        cb->swap(caller, l+1, l);
    if (cb->less(caller, r, l+1))
        cb->swap(caller, r, l+1);
    // Now [l] <= [l+1] <= [r]
    // [l+1] is our pivot and [r] is a sentinel
    uint32_t pivot = l+1;

    uint32_t i = pivot, j = r + 1;
    // The pivot is at [l+1]
    for(;;) {
        while (cb->less(caller, ++i, pivot)) {
        }
        while (cb->less(caller, pivot, --j)) {
        }
        if (i >= j)
            break;
        cb->swap(caller, i, j);
    }

    // put the pivot in its final position
    if (j != pivot)
        cb->swap(caller, pivot, j);

    // To limit the stack size, recurse for the smaller partition and do tail-recursion for the bigger one
    uint32_t sl = j - l;
    uint32_t sr = r - j;
    if (sl <= sr) {
        if (sl > INSERTION_THRESHOLD)
            doQuickSort(caller, cb, limit-1, l, j-1);
        else
            insertionSort(caller, cb, l, j);

        if (sr > INSERTION_THRESHOLD) {
            l = j+1;
            --limit;
            goto tail_recursion;
        } else {
            insertionSort(caller, cb, j+1, r+1);
        }

    } else {
        if (sr > INSERTION_THRESHOLD)
            doQuickSort(caller, cb, limit-1, j+1, r);
        else
            insertionSort(caller, cb, j+1, r+1);

        if (sl > INSERTION_THRESHOLD) {
            r = j-1;
            --limit;
            goto tail_recursion;
        } else {
            insertionSort(caller, cb, l, j);
        }
    }
}

static inline int log2of (uint32_t v)
{
    if (v <= 1)
        return 1;
    --v;
    int res = 0;
    if (v & 0xFFFF0000) { res += 16; v >>= 16; };
    if (v & 0xFF00)     { res += 8; v >>= 8; };
    if (v & 0xF0)       { res += 4; v >>= 4; };
    if (v & 0x0C)       { res += 2; v >>= 2; };
    if (v & 0x02)       { res += 1; v >>= 1; };
    return res + 1;
}

void quickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
   if (end - begin > INSERTION_THRESHOLD)
       doQuickSort(caller, cb, log2of(end - begin)*2, begin, end-1);
   else
       insertionSort(caller, cb, begin, end);
}

/**
 * @param base the beginning of the logical array
 */
static void heapFixDown (StackFrame * caller, IExchangeSortCB * cb, uint32_t base, uint32_t begin, uint32_t end)
{
    if (JS_UNLIKELY(end - begin <= 1))
        return;

    uint32_t lastGood = base + (end - base - 2)/2;
    uint32_t i = begin;

    while (i <= lastGood) {
        uint32_t j = (i - base)*2 + 1 + base;
        // Find the greater of the two children
        if (j+1 < end && cb->less(caller, j, j+1))
            ++j;
        // If the child is greater than us, exchange places
        if (!cb->less(caller, i, j))
            break;

        cb->swap(caller, i, j);
        i = j;
    }
}

void heapSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
    if (JS_UNLIKELY(end - begin <= 1))
        return;

    // "heapify"
    uint32_t start = (end - begin - 2)/2 + begin;
    do
        heapFixDown(caller, cb, begin, start, end);
    while (start-- != begin);

    while (end - begin > 1) {
        --end;
        cb->swap(caller, begin, end);
        heapFixDown(caller, cb, begin, begin, end);
    }
}

}; // namespace js
