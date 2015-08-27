// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_SORT_H
#define JSCOMP_SORT_H

#ifndef JSCOMP_OBJECTS_H
#include "jsc/objects.h"
#endif

namespace js {

struct IExchangeSortCB
{
    virtual void swap (StackFrame * caller, uint32_t a, uint32_t b) = 0;
    virtual bool less (StackFrame * caller, uint32_t a, uint32_t b) = 0;
};

void selectionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end);
void insertionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end);
void quickSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t begin, uint32_t end);

template <class CB, class IT>
void insertionSortAlg (StackFrame * caller, const CB & cb, IT begin, IT end)
{
    for ( IT i = begin + 1; i != end; ++i ) {
        for ( IT j = i; j != begin && cb.less(caller, j, j-1); --j )
            cb.swap(caller, j, j-1);
    }
}


}; // namespace js

#endif //JSCOMP_SORT_H
