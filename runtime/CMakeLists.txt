cmake_minimum_required(VERSION 2.8)
project(jscomp)

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")

if (CMAKE_BUILD_TYPE MATCHES .*Deb.*)
    add_definitions(-DJS_DEBUG)
endif()

include_directories(include)

set(SOURCE_FILES src/runtime.cxx src/gc.cxx include/jsc/runtime.h src/operators.cpp)
add_library(jsruntime ${SOURCE_FILES})
