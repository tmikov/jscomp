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

void selectionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t length);
void insertionSort (StackFrame * caller, IExchangeSortCB * cb, uint32_t length);

}; // namespace js

#endif //JSCOMP_SORT_H
