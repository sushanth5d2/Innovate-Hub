# Makefile for Innovate Hub C++ Native Modules

CXX = g++
CXXFLAGS = -O3 -std=c++17 -fPIC -Wall -Wextra
LDFLAGS = -shared

# Output directory
BUILD_DIR = build
SRC_DIR = .

# Targets
IMAGE_FILTERS = $(BUILD_DIR)/image_filters.so
VIDEO_CODEC = $(BUILD_DIR)/video_codec.so
VIDEO_VALIDATOR = $(BUILD_DIR)/video_validator.so
VIDEO_VALIDATOR_CLI = $(BUILD_DIR)/video_validator_cli

# Source files
IMAGE_FILTERS_SRC = $(SRC_DIR)/image_filters.cpp
VIDEO_CODEC_SRC = $(SRC_DIR)/video_codec.cpp
VIDEO_VALIDATOR_SRC = $(SRC_DIR)/video_validator.cpp

.PHONY: all clean install test cli

all: $(BUILD_DIR) $(IMAGE_FILTERS) $(VIDEO_CODEC) $(VIDEO_VALIDATOR)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(IMAGE_FILTERS): $(IMAGE_FILTERS_SRC)
	@echo "Building image filters library..."
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o $@ $<
	@echo "✓ Built: $@"

$(VIDEO_CODEC): $(VIDEO_CODEC_SRC)
	@echo "Building video codec library..."
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o $@ $<
	@echo "✓ Built: $@"

$(VIDEO_VALIDATOR): $(VIDEO_VALIDATOR_SRC)
	@echo "Building video validator library..."
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o $@ $<
	@echo "✓ Built: $@"

$(VIDEO_VALIDATOR_CLI): $(VIDEO_VALIDATOR_SRC)
	@echo "Building video validator CLI..."
	$(CXX) -O3 -std=c++17 -Wall -Wextra -DBUILD_CLI -o $@ $<
	@echo "✓ Built CLI: $@"

clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	@echo "✓ Clean complete"

install: all
	@echo "Installing libraries to ../../../ml-service/native/"
	mkdir -p ../../../ml-service/native
	cp $(IMAGE_FILTERS) ../../../ml-service/native/
	cp $(VIDEO_CODEC) ../../../ml-service/native/
	cp $(VIDEO_VALIDATOR) ../../../ml-service/native/
	@echo "✓ Installation complete"

cli: $(VIDEO_VALIDATOR_CLI)
	@echo "✓ CLI tool built: $(VIDEO_VALIDATOR_CLI)"
	@echo "Usage: ./$(VIDEO_VALIDATOR_CLI) <video_file>"

test: cli
	@echo "Running C++ module tests..."
	@echo "Note: Run './$(VIDEO_VALIDATOR_CLI) <video_file>' to test video validation"

help:
	@echo "Innovate Hub C++ Native Modules - Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  all      - Build all modules (default)"
	@echo "  clean    - Remove build artifacts"
	@echo "  install  - Build and install to ML service"
	@echo "  cli      - Build command-line test tool"
	@echo "  test     - Run tests"
	@echo "  help     - Show this help message"
	@echo ""
	@echo "Modules:"
	@echo "  image_filters.so    - High-performance image filters"
	@echo "  video_codec.so      - Video encoding/decoding"
	@echo "  video_validator.so  - Video duration validation (NEW!)"
	@echo ""
	@echo "Example usage:"
	@echo "  make          # Build everything"
	@echo "  make clean    # Clean build directory"
	@echo "  make install  # Build and install to ML service"
	@echo "  make cli      # Build CLI test tool"
