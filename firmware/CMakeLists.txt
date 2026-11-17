add_library(pump_core
  src/types.cpp
  src/event_log.cpp
  src/drug_library.cpp
  src/alarm_manager.cpp
  src/detectors.cpp
  src/pump_controller.cpp
  src/protocol.cpp
)
target_include_directories(pump_core PUBLIC include)
target_link_libraries(pump_core PRIVATE pump_warnings)

add_executable(pump_firmware app/main.cpp)
target_link_libraries(pump_firmware PRIVATE pump_core pump_warnings)

if(PUMP_BUILD_TESTS)
  enable_testing()
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    include(FetchContent)
    FetchContent_Declare(googletest
      URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)
  endif()

  add_executable(pump_tests
    tests/test_drug_library.cpp
    tests/test_alarm_manager.cpp
    tests/test_detectors.cpp
    tests/test_pump_controller.cpp
    tests/test_protocol.cpp
  )
  target_link_libraries(pump_tests PRIVATE pump_core pump_warnings GTest::gtest_main)
  include(GoogleTest)
  gtest_discover_tests(pump_tests)
endif()
