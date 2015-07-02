function print(x) {
    __asmh__({},"#include <stdio.h>");
    __asm__({},[],[["x", x]],
            '%[x] = js::toString(&frame, %[x]);\n'+
            'printf("%s\\n", %[x].raw.sval->getStr());'
   );
}

Function.prototype.call = function call (thisArg)
{
   __asm__({},[],[["thisArg", thisArg]],
            'return argc > 1' +
              '? js::call(&frame, argv[0], argc-1, argv+1)' +
              ': js::call(&frame, argv[0], 1, &%[thisArg]);'
   );
}
