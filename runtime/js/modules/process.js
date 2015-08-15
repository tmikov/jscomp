// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.


exports.exit = function exit (code)
{
    __asm__({},[],[["code", code | 0]],[],
        "::exit((int)%[code].raw.nval);"
    );
};
