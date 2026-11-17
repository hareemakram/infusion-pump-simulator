cmake_minimum_required(VERSION 3.20)
project(infusion_pump_simulator VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(PUMP_BUILD_TESTS "Build GoogleTest unit tests" ON)
option(PUMP_COVERAGE "Instrument for code coverage (GCC/Clang)" OFF)
option(PUMP_SANITIZE "Build with AddressSanitizer and UBSan" OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

add_library(pump_warnings INTERFACE)
if(MSVC)
  target_compile_options(pump_warnings INTERFACE /W4 /WX)
else()
  target_compile_options(pump_warnings INTERFACE -Wall -Wextra -Wpedantic -Wshadow -Wconversion
                                                 -Wno-sign-conversion -Werror)
endif()

if(PUMP_COVERAGE)
  add_compile_options(--coverage -O0 -g)
  add_link_options(--coverage)
endif()
if(PUMP_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

add_subdirectory(firmware)
