
function print(x) {
    __asmh__({},"#include <stdio.h>");
    __asm__({},[],[["x", x]],
            '%[x] = js::toString(&frame, %[x]);\n'+
            'printf("%s\\n", %[x].raw.sval->getStr());'
   );
}

var x = {}
print(x);
