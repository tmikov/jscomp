cmake_minimum_required(VERSION 2.8.4)
project(jscomp)

set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

add_subdirectory(runtime/deps)
add_subdirectory(runtime)
