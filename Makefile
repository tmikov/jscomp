NPM_BIN:=$(shell npm bin)

TSC=$(NPM_BIN)/tsc
TSFLAGS=--module commonjs --target ES5 --sourceMap --noImplicitAny --noEmitOnError

JOBS?=2

LIBUV_DIR=runtime/deps/libuv
LIBUV_OUT=$(LIBUV_DIR)/out

%.js : %.ts
	$(TSC) $(TSFLAGS) $<

.PHONY: all clean runtime-debug runtime-release runtime

all:
	$(TSC) $(TSFLAGS) main.ts

clean:
	@rm -f -v *.js *.js.map
	@rm -f -v src/*.js lib/*.js lib/*.js.map
	@rm -rf runtime/debug runtime/release
	@rm -rf runtime/deps/libuv/out

$(LIBUV_OUT)/Makefile: $(LIBUV_DIR)/gyp_uv.py
	cd $(LIBUV_DIR) && ./gyp_uv.py

$(LIBUV_OUT)/Debug/libuv.a: $(LIBUV_OUT)/Makefile
	cd $(LIBUV_OUT) && make BUILDTYPE=Debug -j$(JOBS)

$(LIBUV_OUT)/Release/libuv.a: $(LIBUV_OUT)/Makefile
	cd $(LIBUV_OUT) && make BUILDTYPE=Release -j$(JOBS)

runtime-debug: $(LIBUV_OUT)/Debug/libuv.a
	mkdir -p runtime/debug
	cp $< runtime/debug
	cd runtime/debug && cmake -DCMAKE_BUILD_TYPE=Debug ../.. && make -j$(JOBS)

runtime-release: $(LIBUV_OUT)/Release/libuv.a
	mkdir -p runtime/release
	cp $< runtime/release
	cd runtime/release && cmake -DCMAKE_BUILD_TYPE=Release ../.. && make -j$(JOBS)

runtime: runtime-debug runtime-release
