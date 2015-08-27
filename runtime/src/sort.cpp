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

static void doQuickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t l, uint32_t r)
{
    uint32_t i = l, j = r + 1;
    // The pivot is at [l]
    for(;;) {
        while (cb->less(caller, ++i, l)) {
            if (i == r)
                break;
        }
        while (cb->less(caller, l, --j)) {
        }
        if (i >= j)
            break;
        cb->swap(caller, i, j);
    }

    // put the pivot in its final position
    if (j != l)
        cb->swap(caller, l, j);

    if (j > l+1)
        doQuickSort(caller, cb, l, j-1);
    if (r > j+1)
        doQuickSort(caller, cb, j+1, r);
}

void quickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end)
{
   if (end - begin > 1)
       doQuickSort(caller, cb, begin, end-1);
}

}; // namespace js
