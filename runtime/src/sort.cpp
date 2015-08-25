// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/sort.h"

namespace js {

void selectionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t length)
{
    if (length == 0)
        return;

    for ( uint32_t i = 0, e = length - 1; i < e; ++i ) {
        uint32_t best = i;
        for ( uint32_t j = i + 1; j < length; ++j )
            if (cb->less(caller, j, best))
                best = j;

        if (best != i)
            cb->swap(caller, best, i);
    }
}

void insertionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t length)
{
    for ( uint32_t i = 1; i < length; ++i ) {
        for ( unsigned j = i; j != 0 && cb->less(caller, j, j-1); --j )
            cb->swap(caller, j, j-1);
    }
}

}; // namespace js
