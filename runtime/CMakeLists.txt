cmake_minimum_required(VERSION 2.8)
project(jscomp)

set(HAVE_GOOD_MEMMEM 0 CACHE STRING "The system library has a non-buggy memmem()")

include(CheckCXXSourceCompiles)
include(CheckIncludeFiles)
include(CheckSymbolExists)

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-invalid-offsetof")

CHECK_CXX_SOURCE_COMPILES("
#include <map>
int main (int, char **) {
  std::map<int,int> m;
  m.emplace(1,2);
  return 0;
}
" HAVE_CXX11_EMPLACE
)

CHECK_SYMBOL_EXISTS(srandomdev "stdlib.h" HAVE_SRANDOMDEV)

CHECK_INCLUDE_FILES("endian.h" HAVE_ENDIAN_H)
CHECK_INCLUDE_FILES("machine/endian.h" HAVE_MACHINE_ENDIAN_H)

if (${HAVE_ENDIAN_H})
    set(ENDIAN_H <endian.h>)
elseif (${HAVE_MACHINE_ENDIAN_H})
    set(ENDIAN_H <machine/endian.h>)
else()
    message(SEND_ERROR "Cannot detect endian.h")
endif()

if (CMAKE_BUILD_TYPE MATCHES .*Deb.*)
    add_definitions(-DJS_DEBUG)
endif()

configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/include/jsc/config.h.in"
    "${CMAKE_CURRENT_BINARY_DIR}/include/jsc/config.h"
)

include_directories("${CMAKE_CURRENT_SOURCE_DIR}/include")
include_directories("${CMAKE_CURRENT_BINARY_DIR}/include")

set(SOURCE_FILES
        src/runtime.cxx src/gc.cxx include/jsc/jsruntime.h src/operators.cpp
        include/jsc/utf.h src/utf.cxx include/jsc/common.h include/jsc/jsimpl.h
        include/jsc/objects.h include/jsc/typedarrays.h src/typedarrays.cxx
        src/math.cpp
        src/uri.cpp include/jsc/uri.h src/jsimpl.cpp include/jsc/sort.h src/sort.cpp include/jsc/dtoa.h src/convert.cpp
        src/string.cpp
        src/handles.cpp
        src/jsni.cpp
)
add_library(jsruntime ${SOURCE_FILES} )
