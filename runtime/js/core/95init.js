// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function runtimeInit ()
{
    process = moduleRequire("process");
    console = moduleRequire("console");
    buffer = moduleRequire("buffer");
    Buffer = buffer.Buffer;
}
