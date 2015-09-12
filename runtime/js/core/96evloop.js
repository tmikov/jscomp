// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function runtimeEventLoop ()
{
    __asm__({},[],[],[],
        "uv_loop_t * loop = uv_default_loop();\n" +
        "JS_SET_TOPFRAME(%[%frame]);\n" +
        "uv_run(loop, UV_RUN_DEFAULT);\n" +
        "JS_SET_TOPFRAME(NULL);\n" +
        "uv_loop_close(loop);"
    );
}
