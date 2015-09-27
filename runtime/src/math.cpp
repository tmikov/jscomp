// Copyright (c) 2015 Tzvetan Mikov and contributors (see AUTHORS).
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include "jsc/jsruntime.h"
#include "jsc/config.h"

#include <time.h>

namespace js {

void mathInitRandom ()
{
#ifdef HAVE_SRANDOMDEV
    ::srandomdev();
#else
    ::srand((unsigned)::time(NULL));
#endif
}

double mathRandom ()
{
    return (double)::rand() / ((double)RAND_MAX+1);
}

}; // namespace js
