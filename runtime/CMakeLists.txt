cmake_minimum_required(VERSION 2.8)
project(jscomp)

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")

include_directories(include)

set(SOURCE_FILES examples/ex1.cpp src/runtime.cxx src/gc.cxx include/jsc/runtime.h)
add_executable(jscomp ${SOURCE_FILES})
