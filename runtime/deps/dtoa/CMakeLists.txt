cmake_minimum_required(VERSION 2.8)
project(dtoa)

add_definitions(-DIEEE_8087 -DLong=int)
add_definitions(-DNO_HEX_FP)
add_definitions(-DNO_INFNAN_CHECK)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-parentheses -Wno-unused-label")

add_library(dtoa STATIC dtoa.c g_fmt.c)
