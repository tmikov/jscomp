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
#define INSERTION_THRESHOLD 8

static void doQuickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t l, uint32_t r)
{
tail_recursion:
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
            doQuickSort(caller, cb, l, j-1);
        else
            insertionSort(caller, cb, l, j);

        if (sr > INSERTION_THRESHOLD) {
            l = j+1;
            goto tail_recursion;
        } else {
            insertionSort(caller, cb, j+1, r+1);
        }

    } else {
        if (sr > INSERTION_THRESHOLD)
            doQuickSort(caller, cb, j+1, r);
        else
            insertionSort(caller, cb, j+1, r+1);

        if (sl > INSERTION_THRESHOLD) {
            r = j-1;
            goto tail_recursion;
        } else {
            insertionSort(caller, cb, l, j);
        }
    }
}

void quickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
   if (end - begin > INSERTION_THRESHOLD)
       doQuickSort(caller, cb, begin, end-1);
   else
       insertionSort(caller, cb, begin, end);
}

}; // namespace js
